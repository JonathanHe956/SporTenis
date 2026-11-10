// Descarga el Catálogo Nacional de Códigos Postales de Correos de México y lo carga en la tabla
// CodigosPostales (migración 0016). Uso:
//
//   node db/importar-codigos-postales.mjs                 descarga el catálogo vigente
//   node db/importar-codigos-postales.mjs ruta/al/archivo usa un CPdescargatxt.zip o CPdescarga.txt ya descargado
//
// El catálogo es gratuito para uso particular, pero su licencia no permite distribuirlo a terceros:
// por eso no se guarda en el repositorio y cada instalación lo descarga de la fuente oficial.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import mysql from 'mysql2/promise';

const URL_EXPORTAR = 'https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx';

// Nombres oficiales → los que usa la tienda (ESTADOS_MX en src/lib/direcciones.ts)
const NOMBRE_ESTADO = {
  'Coahuila de Zaragoza': 'Coahuila',
  'México': 'Estado de México',
  'Michoacán de Ocampo': 'Michoacán',
  'Veracruz de Ignacio de la Llave': 'Veracruz',
};

/** Descarga el ZIP del formulario oficial (página ASP.NET: hay que reenviar su estado oculto). */
async function descargarZip() {
  const pagina = await fetch(URL_EXPORTAR);
  if (!pagina.ok) throw new Error(`Correos de México respondió ${pagina.status} al abrir el formulario.`);
  const html = await pagina.text();
  const cookie = (pagina.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const oculto = (nombre) => new RegExp(`id="${nombre}" value="([^"]*)"`).exec(html)?.[1] ?? '';

  const form = new URLSearchParams({
    __EVENTTARGET: '',
    __EVENTARGUMENT: '',
    __LASTFOCUS: '',
    __VIEWSTATE: oculto('__VIEWSTATE'),
    __VIEWSTATEGENERATOR: oculto('__VIEWSTATEGENERATOR'),
    __EVENTVALIDATION: oculto('__EVENTVALIDATION'),
    cboEdo: '00', // todos los estados
    rblTipo: 'txt',
    'btnDescarga.x': '10',
    'btnDescarga.y': '10',
  });
  const res = await fetch(URL_EXPORTAR, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, Referer: URL_EXPORTAR },
    body: form,
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!res.ok || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('No se pudo descargar el catálogo (la respuesta no es un ZIP). Descárgalo a mano y pasa la ruta del archivo.');
  }
  return buffer;
}

/** Extrae el primer archivo de un ZIP usando su directorio central (el catálogo trae solo uno). */
function extraerPrimerArchivo(zip) {
  const finDirectorio = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (finDirectorio < 0) throw new Error('El ZIP está dañado.');
  const central = zip.readUInt32LE(finDirectorio + 16);
  const metodo = zip.readUInt16LE(central + 10);
  const comprimido = zip.readUInt32LE(central + 20);
  const local = zip.readUInt32LE(central + 42);
  const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const datos = zip.subarray(inicio, inicio + comprimido);
  if (metodo === 0) return datos;
  if (metodo === 8) return inflateRawSync(datos);
  throw new Error(`Método de compresión no soportado: ${metodo}.`);
}

function leerCatalogo(buffer) {
  // El archivo viene en Latin-1, separado por "|"; las 2 primeras líneas son la nota legal y los encabezados
  const lineas = buffer.toString('latin1').split(/\r?\n/);
  const encabezados = lineas[1].split('|');
  const col = (nombre) => encabezados.indexOf(nombre);
  const [iCp, iAsenta, iTipo, iMnpio, iEstado, iCiudad] =
    ['d_codigo', 'd_asenta', 'd_tipo_asenta', 'D_mnpio', 'd_estado', 'd_ciudad'].map(col);
  if ([iCp, iAsenta, iTipo, iMnpio, iEstado].some((i) => i < 0)) throw new Error('El catálogo no tiene el formato esperado.');

  const filas = [];
  for (const linea of lineas.slice(2)) {
    if (!linea.trim()) continue;
    const c = linea.split('|');
    if (!/^\d{5}$/.test(c[iCp])) continue;
    filas.push([c[iCp], c[iAsenta].trim(), c[iTipo].trim(), c[iMnpio].trim(), NOMBRE_ESTADO[c[iEstado]] ?? c[iEstado].trim(), c[iCiudad]?.trim() || null]);
  }
  return filas;
}

const ruta = process.argv[2];
console.log(ruta ? `Leyendo ${ruta}…` : 'Descargando el catálogo de Correos de México…');
let archivo = ruta ? readFileSync(ruta) : await descargarZip();
if (archivo.readUInt32LE(0) === 0x04034b50) archivo = extraerPrimerArchivo(archivo);
const filas = leerCatalogo(archivo);
console.log(`${filas.length.toLocaleString('es-MX')} asentamientos leídos.`);

const conexion = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db');
try {
  await conexion.beginTransaction();
  await conexion.query('DELETE FROM CodigosPostales');
  for (let i = 0; i < filas.length; i += 2000) {
    await conexion.query(
      'INSERT INTO CodigosPostales (cp, colonia, tipo_asentamiento, municipio, estado, ciudad) VALUES ?',
      [filas.slice(i, i + 2000)],
    );
  }
  await conexion.commit();
  const [[{ estados, municipios }]] = await conexion.query(
    'SELECT COUNT(DISTINCT estado) estados, COUNT(DISTINCT estado, municipio) municipios FROM CodigosPostales',
  );
  console.log(`Listo: ${filas.length.toLocaleString('es-MX')} colonias en ${municipios} municipios de ${estados} estados.`);
} catch (error) {
  await conexion.rollback();
  if (error?.code === 'ER_NO_SUCH_TABLE') console.error('Falta la tabla: aplica antes db/migrations/0016_codigos_postales.sql.');
  throw error;
} finally {
  await conexion.end();
}
