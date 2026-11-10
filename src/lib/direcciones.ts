// Direcciones de envío del cliente: puede guardar varias, una es la principal y elige una antes de pagar.
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { db } from '../db/db';
import { Direcciones } from '../db/schema';
import { GeoError, validarUbicacion } from './geo';

type Executor = Pick<typeof db, 'select'>;

export const ESTADOS_MX = [
  'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas', 'Chihuahua',
  'Ciudad de México', 'Coahuila', 'Colima', 'Durango', 'Estado de México', 'Guanajuato', 'Guerrero',
  'Hidalgo', 'Jalisco', 'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro',
  'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz',
  'Yucatán', 'Zacatecas',
] as const;

/** Máximo de direcciones guardadas por cliente. */
export const MAX_DIRECCIONES = 10;

export interface DatosDireccion {
  /** Nombre corto para reconocerla: "Casa", "Oficina". */
  alias: string;
  destinatario: string;
  telefono: string;
  calle: string;
  colonia: string;
  ciudad: string;
  estado: string;
  cp: string;
  referencias: string | null;
}

export interface Direccion extends DatosDireccion {
  id: number;
  principal: boolean;
}

export class DireccionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'DireccionError';
    this.status = status;
  }
}

const texto = (valor: unknown, campo: string, max: number, opcional = false): string => {
  const limpio = String(valor ?? '').trim().replace(/\s+/g, ' ');
  if (!limpio && !opcional) throw new DireccionError(`Falta ${campo}.`);
  if (limpio.length > max) throw new DireccionError(`${campo[0].toUpperCase()}${campo.slice(1)} no puede pasar de ${max} caracteres.`);
  return limpio;
};

/**
 * Valida lo que llega del formulario: todos los campos son obligatorios menos las referencias.
 * CP de 5 dígitos, teléfono de 10 y un estado de México.
 */
export function validarDireccion(body: Record<string, unknown>): DatosDireccion {
  const telefono = String(body.telefono ?? '').replace(/\D/g, '');
  if (telefono.length !== 10) throw new DireccionError('El teléfono debe tener 10 dígitos.');

  const cp = String(body.cp ?? '').trim();
  if (!/^\d{5}$/.test(cp)) throw new DireccionError('El código postal debe tener 5 dígitos.');

  const estado = String(body.estado ?? '').trim();
  if (!ESTADOS_MX.includes(estado as (typeof ESTADOS_MX)[number])) throw new DireccionError('Elige un estado de la lista.');

  return {
    alias: texto(body.alias, 'el nombre de la dirección', 100),
    destinatario: texto(body.destinatario, 'el nombre de quien recibe', 255),
    telefono,
    calle: texto(body.calle, 'la calle y el número', 255),
    colonia: texto(body.colonia, 'la colonia', 255),
    ciudad: texto(body.ciudad, 'el municipio', 255),
    estado,
    cp,
    referencias: texto(body.referencias, 'las referencias', 255, true) || null,
  };
}

/**
 * Validación completa para guardar: formato y, con el catálogo de códigos postales cargado,
 * que colonia, municipio y estado correspondan al código postal.
 */
export async function validarDireccionConCatalogo(body: Record<string, unknown>): Promise<DatosDireccion> {
  const datos = validarDireccion(body);
  try {
    await validarUbicacion({ cp: datos.cp, colonia: datos.colonia, municipio: datos.ciudad, estado: datos.estado });
  } catch (error) {
    if (error instanceof GeoError) throw new DireccionError(error.message, error.status);
    throw error;
  }
  return datos;
}

/** Copia legible que se guarda en la venta: el pedido conserva la dirección aunque luego cambie. */
export const formatearDireccion = (d: DatosDireccion): string =>
  [
    `${d.destinatario} · Tel. ${d.telefono}`,
    `${d.calle}, Col. ${d.colonia}`,
    `${d.ciudad}, ${d.estado}, C.P. ${d.cp}`,
    d.referencias ? `Referencias: ${d.referencias}` : null,
  ].filter(Boolean).join('\n');

const aDireccion = (row: typeof Direcciones.$inferSelect): Direccion => ({
  id: row.id,
  alias: row.tipo_direccion,
  destinatario: row.destinatario ?? '',
  telefono: row.telefono ?? '',
  calle: row.calle,
  colonia: row.colonia ?? '',
  ciudad: row.ciudad,
  estado: row.estado_provincia,
  cp: row.cp,
  referencias: row.referencias,
  principal: row.es_principal,
});

const columnas = (d: DatosDireccion) => ({
  tipo_direccion: d.alias,
  destinatario: d.destinatario,
  telefono: d.telefono,
  calle: d.calle,
  colonia: d.colonia,
  ciudad: d.ciudad,
  estado_provincia: d.estado,
  cp: d.cp,
  referencias: d.referencias,
});

/** Direcciones del cliente, la principal primero. */
export async function listarDirecciones(id_cliente: number): Promise<Direccion[]> {
  const rows = await db
    .select()
    .from(Direcciones)
    .where(eq(Direcciones.id_cliente, id_cliente))
    .orderBy(desc(Direcciones.es_principal), asc(Direcciones.id));
  return rows.map(aDireccion);
}

/** Una dirección solo si es de ese cliente (así nadie usa ni edita direcciones ajenas). */
export async function obtenerDireccion(id_cliente: number, id: number, executor: Executor = db): Promise<Direccion> {
  const [row] = await executor
    .select()
    .from(Direcciones)
    .where(and(eq(Direcciones.id, id), eq(Direcciones.id_cliente, id_cliente)));
  if (!row) throw new DireccionError('Elige una dirección de envío válida.', 404);
  return aDireccion(row);
}

/** La primera dirección que guarda el cliente queda como principal; con `principal` pasa a serlo. */
export async function crearDireccion(id_cliente: number, datos: DatosDireccion, principal = false): Promise<number> {
  return db.transaction(async (tx) => {
    const existentes = await tx.select({ id: Direcciones.id }).from(Direcciones).where(eq(Direcciones.id_cliente, id_cliente));
    if (existentes.length >= MAX_DIRECCIONES) {
      throw new DireccionError(`Puedes guardar hasta ${MAX_DIRECCIONES} direcciones. Borra alguna para agregar otra.`, 409);
    }
    const esPrincipal = principal || existentes.length === 0;
    if (esPrincipal) await tx.update(Direcciones).set({ es_principal: false }).where(eq(Direcciones.id_cliente, id_cliente));
    const [res] = await tx.insert(Direcciones).values({ id_cliente, ...columnas(datos), es_principal: esPrincipal });
    return Number(res.insertId);
  });
}

export async function actualizarDireccion(id_cliente: number, id: number, datos: DatosDireccion): Promise<void> {
  await obtenerDireccion(id_cliente, id);
  await db.update(Direcciones).set(columnas(datos)).where(and(eq(Direcciones.id, id), eq(Direcciones.id_cliente, id_cliente)));
}

export async function marcarPrincipal(id_cliente: number, id: number): Promise<void> {
  await obtenerDireccion(id_cliente, id);
  await db.transaction(async (tx) => {
    await tx.update(Direcciones).set({ es_principal: false }).where(eq(Direcciones.id_cliente, id_cliente));
    await tx.update(Direcciones).set({ es_principal: true }).where(eq(Direcciones.id, id));
  });
}

/**
 * Borra la dirección. Los pedidos que la usaron conservan su copia (Ventas.direccion_envio).
 * Si era la principal, la siguiente pasa a serlo.
 */
export async function eliminarDireccion(id_cliente: number, id: number): Promise<void> {
  const direccion = await obtenerDireccion(id_cliente, id);
  await db.transaction(async (tx) => {
    await tx.delete(Direcciones).where(eq(Direcciones.id, id));
    if (!direccion.principal) return;
    const [siguiente] = await tx
      .select({ id: Direcciones.id })
      .from(Direcciones)
      .where(and(eq(Direcciones.id_cliente, id_cliente), ne(Direcciones.id, id)))
      .orderBy(asc(Direcciones.id))
      .limit(1);
    if (siguiente) await tx.update(Direcciones).set({ es_principal: true }).where(eq(Direcciones.id, siguiente.id));
  });
}
