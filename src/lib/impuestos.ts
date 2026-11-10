import { asc, eq } from 'drizzle-orm';
import { db } from '../db/db';
import { Impuestos } from '../db/schema';

type Executor = Pick<typeof db, 'select'>;

/** IVA de México; se usa mientras la tabla Impuestos no exista. */
export const IVA_POR_DEFECTO = 0.16;

/** Nombre del impuesto de respaldo y de las facturas antiguas sin detalle por impuesto. */
export const NOMBRE_IVA = 'IVA';

export const ESTADOS_IMPUESTO = ['Activo', 'Inactivo'] as const;
export type EstadoImpuesto = (typeof ESTADOS_IMPUESTO)[number];

export interface Impuesto {
  id: number;
  nombre: string;
  porcentaje: number;
  estado: EstadoImpuesto;
}

export interface DatosImpuesto {
  nombre: string;
  porcentaje: number;
  estado: EstadoImpuesto;
}

/** Error de validación cuyo mensaje se puede mostrar en el panel. */
export class ImpuestoError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ImpuestoError';
    this.status = status;
  }
}

/** Convierte un porcentaje guardado (16.00) en la tasa que usan los cálculos (0.16). */
export const porcentajeATasa = (porcentaje: number): number => Math.round(porcentaje * 100) / 10000;

/**
 * Valida lo que llega del formulario o la API. Con `parcial` solo se revisan los campos enviados,
 * para que un PUT pueda cambiar, por ejemplo, solo el estado.
 */
export function validarImpuesto(body: Record<string, unknown>, parcial = false): Partial<DatosImpuesto> {
  const datos: Partial<DatosImpuesto> = {};

  if (!parcial || body.nombre !== undefined) {
    const nombre = String(body.nombre ?? '').trim();
    if (!nombre) throw new ImpuestoError('El nombre del impuesto es obligatorio.');
    if (nombre.length > 100) throw new ImpuestoError('El nombre no puede pasar de 100 caracteres.');
    datos.nombre = nombre;
  }

  if (!parcial || body.porcentaje !== undefined) {
    const porcentaje = Number(body.porcentaje);
    if (body.porcentaje === '' || body.porcentaje === null || !Number.isFinite(porcentaje)) {
      throw new ImpuestoError('El porcentaje debe ser un número.');
    }
    if (porcentaje < 0 || porcentaje > 100) throw new ImpuestoError('El porcentaje debe estar entre 0 y 100.');
    datos.porcentaje = Math.round(porcentaje * 100) / 100;
  }

  if (!parcial || body.estado !== undefined) {
    const estado = String(body.estado ?? 'Activo');
    if (!ESTADOS_IMPUESTO.includes(estado as EstadoImpuesto)) {
      throw new ImpuestoError('El estado debe ser Activo o Inactivo.');
    }
    datos.estado = estado as EstadoImpuesto;
  }

  return datos;
}

const aImpuesto = (row: typeof Impuestos.$inferSelect): Impuesto => ({
  id: row.id,
  nombre: row.nombre,
  porcentaje: Number(row.porcentaje),
  estado: row.estado as EstadoImpuesto,
});

export async function listarImpuestos(soloActivos = false): Promise<Impuesto[]> {
  const rows = await db
    .select()
    .from(Impuestos)
    .where(soloActivos ? eq(Impuestos.estado, 'Activo') : undefined)
    .orderBy(asc(Impuestos.nombre));
  return rows.map(aImpuesto);
}

export async function crearImpuesto(datos: DatosImpuesto): Promise<number> {
  const existente = await db.select({ id: Impuestos.id }).from(Impuestos).where(eq(Impuestos.nombre, datos.nombre));
  if (existente[0]) throw new ImpuestoError(`Ya existe un impuesto llamado ${datos.nombre}.`, 409);

  const [res] = await db.insert(Impuestos).values({ ...datos, porcentaje: datos.porcentaje.toFixed(2) });
  return Number(res.insertId);
}

export async function actualizarImpuesto(id: number, datos: Partial<DatosImpuesto>): Promise<void> {
  const actual = await db.select({ id: Impuestos.id, nombre: Impuestos.nombre }).from(Impuestos).where(eq(Impuestos.id, id));
  if (!actual[0]) throw new ImpuestoError('Impuesto no encontrado.', 404);
  if (datos.nombre !== undefined && datos.nombre !== actual[0].nombre) {
    const repetido = await db.select({ id: Impuestos.id }).from(Impuestos).where(eq(Impuestos.nombre, datos.nombre));
    if (repetido[0]) throw new ImpuestoError(`Ya existe un impuesto llamado ${datos.nombre}.`, 409);
  }

  if (Object.keys(datos).length === 0) return;
  await db
    .update(Impuestos)
    .set({ ...datos, porcentaje: datos.porcentaje === undefined ? undefined : datos.porcentaje.toFixed(2) })
    .where(eq(Impuestos.id, id));
}

// ── Impuestos incluidos en el precio ──────────────────────────────────
// El precio del catálogo (Productos.precio_venta) es el precio final al público, con los
// impuestos incluidos: es lo que se cobra. Los impuestos activos solo se desglosan dentro
// de ese precio (tienda, carrito, ticket y factura); cambiarlos no cambia el precio.

export interface ImpuestoAplicado {
  nombre: string;
  porcentaje: number;
  tasa: number;
}

export interface LineaImpuesto {
  nombre: string;
  porcentaje: number;
  monto: number;
}

/** Lo que se desglosa mientras no haya impuestos registrados (o falte la migración 0010): IVA al 16%. */
export const IMPUESTOS_POR_DEFECTO: readonly ImpuestoAplicado[] = [
  { nombre: NOMBRE_IVA, porcentaje: IVA_POR_DEFECTO * 100, tasa: IVA_POR_DEFECTO },
];

/**
 * Impuestos activos a partir de los registros guardados. Sin ningún registro se usa el IVA
 * de respaldo; con registros pero todos inactivos no se desglosa ningún impuesto.
 */
export const impuestosDesdeRegistros = (
  registros: ReadonlyArray<{ nombre: string; porcentaje: number | string; estado: string }>,
): ImpuestoAplicado[] => {
  if (registros.length === 0) return [...IMPUESTOS_POR_DEFECTO];
  return registros
    .filter((r) => r.estado === 'Activo')
    .map((r) => ({ nombre: r.nombre, porcentaje: Number(r.porcentaje), tasa: porcentajeATasa(Number(r.porcentaje)) }));
};

/** Impuestos incluidos hoy en los precios. Si la tabla aún no existe se usa el IVA de siempre. */
export async function impuestosVigentes(executor: Executor = db): Promise<ImpuestoAplicado[]> {
  try {
    const rows = await executor
      .select({ nombre: Impuestos.nombre, porcentaje: Impuestos.porcentaje, estado: Impuestos.estado })
      .from(Impuestos)
      .orderBy(asc(Impuestos.id));
    return impuestosDesdeRegistros(rows);
  } catch {
    return [...IMPUESTOS_POR_DEFECTO];
  }
}

/** Suma de las tasas activas (IVA 16% + otro 8% = 0.24). */
export const tasaTotal = (impuestos: readonly ImpuestoAplicado[]): number =>
  Math.round(impuestos.reduce((total, imp) => total + imp.tasa, 0) * 1_000_000) / 1_000_000;

/**
 * Separa un precio o total (impuestos incluidos) en su base y el monto de cada impuesto, sin perder centavos:
 * el último impuesto con tasa absorbe el redondeo para que base + impuestos = total exacto.
 */
export const desglosarImpuestos = (
  total: number,
  impuestos: readonly ImpuestoAplicado[],
): { subtotal: number; impuestos: LineaImpuesto[]; total_impuestos: number; total: number } => {
  const totalCents = Math.round(total * 100);
  const baseCents = Math.round(totalCents / (1 + tasaTotal(impuestos)));
  let restante = totalCents - baseCents;
  // El redondeo va al último impuesto que sí cobra algo (uno al 0% siempre queda en $0)
  const ultimo = impuestos.findLastIndex((imp) => imp.tasa > 0);

  const lineas = impuestos.map((imp, i) => {
    const cents = i === ultimo ? restante : imp.tasa > 0 ? Math.min(restante, Math.round(baseCents * imp.tasa)) : 0;
    restante -= cents;
    return { nombre: imp.nombre, porcentaje: imp.porcentaje, monto: cents / 100 };
  });

  return {
    subtotal: baseCents / 100,
    impuestos: lineas,
    total_impuestos: (totalCents - baseCents) / 100,
    total: totalCents / 100,
  };
};
