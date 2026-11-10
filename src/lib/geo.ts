// Municipios y colonias del Catálogo Nacional de Códigos Postales (tabla CodigosPostales).
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { CodigosPostales } from '../db/schema';
import { esTablaInexistente } from './dbErrores';

export interface Colonia {
  nombre: string;
  tipo: string;
}

export interface CodigoPostal {
  cp: string;
  estado: string;
  municipio: string;
  colonias: Colonia[];
}

/** Error de consulta cuyo mensaje se puede mostrar en el formulario. */
export class GeoError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GeoError';
    this.status = status;
  }
}

const SIN_CATALOGO = 'El catálogo de códigos postales no está cargado. Corre: node db/importar-codigos-postales.mjs';

/** El catálogo pesa ~160 mil filas: se revisa una vez si ya se importó y se recuerda el resultado. */
let catalogoListo: boolean | null = null;
export async function catalogoDisponible(): Promise<boolean> {
  if (catalogoListo) return true;
  try {
    const [fila] = await db.select({ n: sql<number>`1` }).from(CodigosPostales).limit(1);
    catalogoListo = Boolean(fila);
  } catch (error) {
    if (!esTablaInexistente(error)) throw error;
    catalogoListo = false;
  }
  return catalogoListo;
}

export async function listarMunicipios(estado: string): Promise<string[]> {
  if (!(await catalogoDisponible())) throw new GeoError(SIN_CATALOGO, 503);
  const rows = await db
    .selectDistinct({ municipio: CodigosPostales.municipio })
    .from(CodigosPostales)
    .where(eq(CodigosPostales.estado, estado))
    .orderBy(asc(CodigosPostales.municipio));
  return rows.map((r) => r.municipio);
}

/** Estado, municipio y colonias de un código postal; null si no existe. */
export async function buscarCodigoPostal(cp: string): Promise<CodigoPostal | null> {
  if (!/^\d{5}$/.test(cp)) throw new GeoError('El código postal debe tener 5 dígitos.');
  if (!(await catalogoDisponible())) throw new GeoError(SIN_CATALOGO, 503);

  const rows = await db
    .select({
      colonia: CodigosPostales.colonia,
      tipo: CodigosPostales.tipo_asentamiento,
      municipio: CodigosPostales.municipio,
      estado: CodigosPostales.estado,
    })
    .from(CodigosPostales)
    .where(eq(CodigosPostales.cp, cp))
    .orderBy(asc(CodigosPostales.colonia));
  if (rows.length === 0) return null;

  // Un código postal pertenece a un solo municipio; se toma el del primer asentamiento
  const { estado, municipio } = rows[0];
  const vistas = new Set<string>();
  const colonias = rows
    .filter((r) => r.estado === estado && r.municipio === municipio)
    .filter((r) => !vistas.has(r.colonia) && vistas.add(r.colonia))
    .map((r) => ({ nombre: r.colonia, tipo: r.tipo }));
  return { cp, estado, municipio, colonias };
}

/**
 * Revisa que colonia, municipio y estado correspondan al código postal según el catálogo.
 * Si el catálogo no está cargado no se puede revisar y se deja pasar (la dirección ya se validó por formato).
 */
export async function validarUbicacion(datos: { cp: string; colonia: string; municipio: string; estado: string }): Promise<void> {
  if (!(await catalogoDisponible())) return;
  const [fila] = await db
    .select({ municipio: CodigosPostales.municipio, estado: CodigosPostales.estado })
    .from(CodigosPostales)
    .where(and(eq(CodigosPostales.cp, datos.cp), eq(CodigosPostales.colonia, datos.colonia)))
    .limit(1);
  if (!fila) throw new GeoError('Elige una colonia de la lista de tu código postal.');
  if (fila.estado !== datos.estado || fila.municipio !== datos.municipio) {
    throw new GeoError(`El código postal ${datos.cp} es de ${fila.municipio}, ${fila.estado}.`);
  }
}
