import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/db';
import { Productos, Promociones, PromocionesProductos } from '../db/schema';
import { esTablaInexistente } from './dbErrores';

export type TipoDescuento = 'porcentaje' | 'monto';
export const TIPOS_DESCUENTO: readonly TipoDescuento[] = ['porcentaje', 'monto'];

export const ESTADOS_PROMOCION = ['Activa', 'Inactiva'] as const;
export type EstadoPromocion = (typeof ESTADOS_PROMOCION)[number];

export interface PromocionPrecio {
  tipo_descuento: TipoDescuento;
  valor: number | string;
  fecha_inicio: Date | string;
  fecha_fin: Date | string;
  estado: EstadoPromocion;
}

export interface ProductoConPromociones {
  precio_venta: number | string;
  promociones?: readonly PromocionPrecio[];
}

const aCentavos = (monto: number): number => Math.round((monto + Number.EPSILON) * 100);

const fechaEnMilisegundos = (fecha: Date | string): number => {
  const timestamp = fecha instanceof Date ? fecha.getTime() : new Date(fecha).getTime();
  if (!Number.isFinite(timestamp)) throw new RangeError('Fecha de promoción inválida.');
  return timestamp;
};

/** Devuelve el precio final; si coinciden varias promociones, aplica solo la más conveniente. */
export const precioConPromocion = (
  producto: ProductoConPromociones,
  fechaActual: Date = new Date(),
): number => {
  const precio = Number(producto.precio_venta);
  if (!Number.isFinite(precio) || precio < 0) throw new RangeError('Precio de producto inválido.');

  const precioBaseCentavos = aCentavos(precio);
  const ahora = fechaEnMilisegundos(fechaActual);
  let mejorPrecioCentavos = precioBaseCentavos;

  for (const promocion of producto.promociones ?? []) {
    if (promocion.estado !== 'Activa') continue;

    const inicio = fechaEnMilisegundos(promocion.fecha_inicio);
    const fin = fechaEnMilisegundos(promocion.fecha_fin);
    if (inicio > fin) throw new RangeError('La fecha de inicio de la promoción debe ser anterior a su fecha de fin.');
    if (ahora < inicio || ahora > fin) continue;

    const valor = Number(promocion.valor);
    if (!Number.isFinite(valor) || valor <= 0 || (promocion.tipo_descuento === 'porcentaje' && valor > 100)) {
      throw new RangeError('Valor de descuento inválido.');
    }

    const descuentoCentavos = promocion.tipo_descuento === 'porcentaje'
      ? Math.round(precioBaseCentavos * (valor / 100))
      : aCentavos(valor);
    mejorPrecioCentavos = Math.min(mejorPrecioCentavos, Math.max(0, precioBaseCentavos - descuentoCentavos));
  }

  return mejorPrecioCentavos / 100;
};

// ── Precios de la tienda ──────────────────────────────────────────────

type Executor = Pick<typeof db, 'select'>;

/**
 * Promociones activas asignadas a cada producto. La vigencia por fechas la decide
 * `precioConPromocion`, así una sola regla calcula el precio en tienda, carrito y venta.
 */
export async function promocionesPorProducto(
  ids: readonly number[],
  executor: Executor = db,
): Promise<Map<number, PromocionPrecio[]>> {
  const porProducto = new Map<number, PromocionPrecio[]>();
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return porProducto;

  let rows;
  try {
    rows = await executor
      .select({
        id_producto: PromocionesProductos.id_producto,
        tipo_descuento: Promociones.tipo_descuento,
        valor: Promociones.valor,
        fecha_inicio: Promociones.fecha_inicio,
        fecha_fin: Promociones.fecha_fin,
        estado: Promociones.estado,
      })
      .from(PromocionesProductos)
      .innerJoin(Promociones, eq(PromocionesProductos.id_promocion, Promociones.id))
      .where(inArray(PromocionesProductos.id_producto, unicos));
  } catch (error) {
    // Sin la tabla de promociones la tienda sigue vendiendo a precio de lista
    if (esTablaInexistente(error)) return porProducto;
    throw error;
  }

  for (const { id_producto, ...promocion } of rows) {
    if (promocion.estado !== 'Activa') continue;
    const lista = porProducto.get(id_producto) ?? [];
    lista.push(promocion);
    porProducto.set(id_producto, lista);
  }
  return porProducto;
}

export interface PrecioAlPublico {
  /** Precio de lista: el capturado en el producto (impuestos incluidos). */
  lista: number;
  /** Lo que se cobra: precio de lista menos la mejor promoción vigente. */
  final: number;
}

/** Precio al público de un producto; una promoción con datos dañados nunca bloquea la venta. */
export const precioAlPublico = (
  id_producto: number,
  precio_venta: number | string,
  promociones: readonly PromocionPrecio[] | undefined,
  fechaActual: Date = new Date(),
): PrecioAlPublico => {
  const lista = Math.round((Number(precio_venta) || 0) * 100) / 100;
  try {
    return { lista, final: precioConPromocion({ precio_venta: lista, promociones }, fechaActual) };
  } catch (error) {
    console.error(`Promoción inválida para el producto ${id_producto}:`, error);
    return { lista, final: lista };
  }
};

/** Precio al público de varios productos con las promociones vigentes. */
export async function preciosVigentes(
  productos: ReadonlyArray<{ id: number; precio_venta: number | string }>,
  opciones: { executor?: Executor; fechaActual?: Date } = {},
): Promise<Map<number, PrecioAlPublico>> {
  const promociones = await promocionesPorProducto(productos.map((p) => p.id), opciones.executor ?? db);
  return new Map(productos.map((p) => [
    p.id,
    precioAlPublico(p.id, p.precio_venta, promociones.get(p.id), opciones.fechaActual),
  ]));
}

/** Etiqueta del descuento para la tienda: "-20%". */
export const etiquetaDescuento = (precioLista: number, precioFinal: number): string =>
  precioLista > 0 ? `-${Math.max(1, Math.round((1 - precioFinal / precioLista) * 100))}%` : '';

// ── Administración (SCM) ──────────────────────────────────────────────

export class PromocionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PromocionError';
    this.status = status;
  }
}

export interface DatosPromocion {
  nombre: string;
  descripcion: string | null;
  tipo_descuento: TipoDescuento;
  valor: number;
  fecha_inicio: Date;
  fecha_fin: Date;
  estado: EstadoPromocion;
  productos: number[];
}

export type VigenciaPromocion = 'Vigente' | 'Programada' | 'Vencida' | 'Inactiva';

export interface Promocion extends Omit<DatosPromocion, 'valor'> {
  id: number;
  valor: number;
  vigencia: VigenciaPromocion;
}

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Una fecha sin hora ("2026-11-10") cubre el día completo en la hora local de la tienda:
 * el inicio a las 00:00:00 y el fin a las 23:59:59.
 */
export const leerFechaPromocion = (valor: unknown, limite: 'inicio' | 'fin'): Date => {
  const texto = valor instanceof Date ? valor.toISOString() : String(valor ?? '').trim();
  const fecha = SOLO_FECHA.test(texto)
    ? new Date(`${texto}T${limite === 'inicio' ? '00:00:00' : '23:59:59'}`)
    : new Date(texto);
  if (!texto || !Number.isFinite(fecha.getTime())) {
    throw new PromocionError(`La fecha de ${limite} no es válida.`);
  }
  return fecha;
};

/**
 * Valida lo que llega del panel o la API. Con `parcial` solo se revisan los campos enviados
 * (p. ej. activar o pausar); el cruce de fechas y valor se revisa después contra lo guardado.
 */
export function validarPromocion(body: Record<string, unknown>, parcial = false): Partial<DatosPromocion> {
  const datos: Partial<DatosPromocion> = {};
  const viene = (campo: string) => !parcial || body[campo] !== undefined;

  if (viene('nombre')) {
    const nombre = String(body.nombre ?? '').trim();
    if (!nombre) throw new PromocionError('El nombre de la promoción es obligatorio.');
    if (nombre.length > 255) throw new PromocionError('El nombre no puede pasar de 255 caracteres.');
    datos.nombre = nombre;
  }

  if (viene('descripcion')) {
    const descripcion = String(body.descripcion ?? '').trim();
    datos.descripcion = descripcion || null;
  }

  if (viene('tipo_descuento')) {
    const tipo = String(body.tipo_descuento ?? '');
    if (!TIPOS_DESCUENTO.includes(tipo as TipoDescuento)) {
      throw new PromocionError('El tipo de descuento debe ser porcentaje o monto.');
    }
    datos.tipo_descuento = tipo as TipoDescuento;
  }

  if (viene('valor')) {
    const valor = Number(body.valor);
    if (body.valor === '' || body.valor === null || !Number.isFinite(valor) || valor <= 0) {
      throw new PromocionError('El descuento debe ser un número mayor a 0.');
    }
    datos.valor = Math.round(valor * 100) / 100;
  }

  if (viene('fecha_inicio')) datos.fecha_inicio = leerFechaPromocion(body.fecha_inicio, 'inicio');
  if (viene('fecha_fin')) datos.fecha_fin = leerFechaPromocion(body.fecha_fin, 'fin');

  if (viene('estado')) {
    const estado = String(body.estado ?? 'Activa');
    if (!ESTADOS_PROMOCION.includes(estado as EstadoPromocion)) {
      throw new PromocionError('El estado debe ser Activa o Inactiva.');
    }
    datos.estado = estado as EstadoPromocion;
  }

  if (viene('productos')) {
    if (!Array.isArray(body.productos)) throw new PromocionError('Selecciona los productos de la promoción.');
    const productos = [...new Set(body.productos.map(Number))];
    if (productos.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new PromocionError('La lista de productos no es válida.');
    }
    if (productos.length === 0) throw new PromocionError('Selecciona al menos un producto.');
    datos.productos = productos;
  }

  return datos;
}

/** Reglas que dependen de varios campos; se aplican a la promoción completa ya combinada. */
export function validarCoherencia(datos: Pick<DatosPromocion, 'tipo_descuento' | 'valor' | 'fecha_inicio' | 'fecha_fin'>): void {
  if (datos.tipo_descuento === 'porcentaje' && datos.valor > 100) {
    throw new PromocionError('Un descuento porcentual no puede pasar de 100%.');
  }
  if (datos.fecha_inicio.getTime() > datos.fecha_fin.getTime()) {
    throw new PromocionError('La fecha de inicio debe ser anterior a la fecha de fin.');
  }
}

export const vigenciaPromocion = (
  promocion: Pick<DatosPromocion, 'estado' | 'fecha_inicio' | 'fecha_fin'>,
  fechaActual: Date = new Date(),
): VigenciaPromocion => {
  if (promocion.estado !== 'Activa') return 'Inactiva';
  const ahora = fechaActual.getTime();
  if (ahora < promocion.fecha_inicio.getTime()) return 'Programada';
  if (ahora > promocion.fecha_fin.getTime()) return 'Vencida';
  return 'Vigente';
};

export async function listarPromociones(fechaActual: Date = new Date()): Promise<Promocion[]> {
  const [rows, asignaciones] = await Promise.all([
    db.select().from(Promociones).orderBy(asc(Promociones.fecha_inicio), asc(Promociones.id)),
    db.select().from(PromocionesProductos),
  ]);

  const productosPorPromocion = new Map<number, number[]>();
  for (const { id_promocion, id_producto } of asignaciones) {
    productosPorPromocion.set(id_promocion, [...(productosPorPromocion.get(id_promocion) ?? []), id_producto]);
  }

  return rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    descripcion: row.descripcion,
    tipo_descuento: row.tipo_descuento,
    valor: Number(row.valor),
    fecha_inicio: row.fecha_inicio,
    fecha_fin: row.fecha_fin,
    estado: row.estado,
    productos: productosPorPromocion.get(row.id) ?? [],
    vigencia: vigenciaPromocion(row, fechaActual),
  }));
}

const columnas = (datos: Partial<DatosPromocion>) => {
  const { productos: _productos, valor, ...resto } = datos;
  return { ...resto, ...(valor === undefined ? {} : { valor: valor.toFixed(2) }) };
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const asignarProductos = async (tx: Tx, id_promocion: number, productos: number[]): Promise<void> => {
  const existentes = await tx.select({ id: Productos.id }).from(Productos).where(inArray(Productos.id, productos));
  if (existentes.length !== productos.length) throw new PromocionError('Alguno de los productos ya no existe.', 404);
  await tx.insert(PromocionesProductos).values(productos.map((id_producto) => ({ id_promocion, id_producto })));
};

export async function crearPromocion(datos: DatosPromocion): Promise<number> {
  validarCoherencia(datos);

  return db.transaction(async (tx) => {
    const [res] = await tx.insert(Promociones).values(columnas(datos) as typeof Promociones.$inferInsert);
    const id = Number(res.insertId);
    await asignarProductos(tx, id, datos.productos);
    return id;
  });
}

export async function actualizarPromocion(id: number, datos: Partial<DatosPromocion>): Promise<void> {
  await db.transaction(async (tx) => {
    const [actual] = await tx.select().from(Promociones).where(eq(Promociones.id, id)).for('update');
    if (!actual) throw new PromocionError('Promoción no encontrada.', 404);

    validarCoherencia({
      tipo_descuento: datos.tipo_descuento ?? actual.tipo_descuento,
      valor: datos.valor ?? Number(actual.valor),
      fecha_inicio: datos.fecha_inicio ?? actual.fecha_inicio,
      fecha_fin: datos.fecha_fin ?? actual.fecha_fin,
    });

    const cambios = columnas(datos);
    if (Object.keys(cambios).length > 0) await tx.update(Promociones).set(cambios).where(eq(Promociones.id, id));

    if (datos.productos) {
      await tx.delete(PromocionesProductos).where(eq(PromocionesProductos.id_promocion, id));
      await asignarProductos(tx, id, datos.productos);
    }
  });
}

export async function eliminarPromocion(id: number): Promise<void> {
  const [res] = await db.delete(Promociones).where(eq(Promociones.id, id));
  if (res.affectedRows === 0) throw new PromocionError('Promoción no encontrada.', 404);
}
