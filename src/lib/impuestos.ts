import { asc, eq } from 'drizzle-orm';
import { db } from '../db/db';
import { Impuestos } from '../db/schema';

type Executor = Pick<typeof db, 'select'>;

/** IVA de México; se usa mientras la tabla Impuestos no exista. */
export const IVA_POR_DEFECTO = 0.16;

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
  const actual = await db.select({ id: Impuestos.id }).from(Impuestos).where(eq(Impuestos.id, id));
  if (!actual[0]) throw new ImpuestoError('Impuesto no encontrado.', 404);

  if (Object.keys(datos).length === 0) return;
  await db
    .update(Impuestos)
    .set({ ...datos, porcentaje: datos.porcentaje === undefined ? undefined : datos.porcentaje.toFixed(2) })
    .where(eq(Impuestos.id, id));
}

/** Tasa que corresponde al registro del IVA: 0 si está inactivo, la de siempre si no existe. */
export const tasaDesdeRegistro = (registro?: { porcentaje: number; estado: string }): number => {
  if (!registro) return IVA_POR_DEFECTO;
  return registro.estado === 'Activo' ? porcentajeATasa(registro.porcentaje) : 0;
};

/**
 * Tasa de IVA vigente para el checkout y la factura. Si la migración 0010 aún no se
 * aplicó, se usa la tasa de siempre (16%) para no frenar las ventas.
 */
export async function tasaIvaVigente(executor: Executor = db): Promise<number> {
  try {
    const rows = await executor
      .select({ porcentaje: Impuestos.porcentaje, estado: Impuestos.estado })
      .from(Impuestos)
      .where(eq(Impuestos.nombre, 'IVA'));
    return tasaDesdeRegistro(rows[0] && { porcentaje: Number(rows[0].porcentaje), estado: rows[0].estado });
  } catch {
    return IVA_POR_DEFECTO;
  }
}
