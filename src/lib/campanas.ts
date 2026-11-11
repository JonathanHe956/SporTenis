// Campañas de correo: el administrador manda un mismo correo (una promoción, novedades) a los clientes
// con cuenta en la tienda desde /crm/campanas.
//   - Solo se manda a clientes (no a las cuentas del personal) que no se han dado de baja, no está inactivo y tiene un correo que puede recibir
//     (se saltan los dominios reservados de prueba como @sportenis.test).
//   - Cada correo trae un enlace personal para darse de baja (/baja?t=<token>).
//   - El envío corre en segundo plano, uno por uno, y va guardando su avance en CampanasCorreo.
import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/db';
import { CampanasCorreo, Clientes, Promociones, Roles, Usuarios } from '../db/schema';
import { roleFromName } from './auth';
import { CORREO_VALIDO, enviarCorreo, escaparHtml, parrafoSeguro, plantillaCorreo, urlTienda, type Correo } from './correo';
import { listarPromociones, type Promocion } from './promociones';

export class CampanaError extends Error {}

export const LIMITES = { asunto: 150, titulo: 150, mensaje: 5000, botonTexto: 60, botonUrl: 500 } as const;

/** Tope de destinatarios por campaña: Gmail gratuito permite unos 500 correos al día. */
export const limiteCampana = (): number => Number(process.env.CORREO_LIMITE_CAMPANA) || 450;

export interface DatosCampana {
  asunto: string;
  titulo: string;
  mensaje: string;
  idPromocion: number | null;
  boton: { texto: string; url: string } | null;
}

const texto = (form: FormData, campo: string): string => form.get(campo)?.toString().trim() ?? '';

/** Lee y valida el formulario de /crm/campanas. */
export function validarCampana(form: FormData): DatosCampana {
  const asunto = texto(form, 'asunto');
  const titulo = texto(form, 'titulo');
  const mensaje = texto(form, 'mensaje').replace(/\r\n/g, '\n');
  if (!asunto) throw new CampanaError('Escribe el asunto del correo.');
  if (!titulo) throw new CampanaError('Escribe el título del correo.');
  if (!mensaje) throw new CampanaError('Escribe el mensaje.');
  if (asunto.length > LIMITES.asunto) throw new CampanaError(`El asunto admite hasta ${LIMITES.asunto} caracteres.`);
  if (titulo.length > LIMITES.titulo) throw new CampanaError(`El título admite hasta ${LIMITES.titulo} caracteres.`);
  if (mensaje.length > LIMITES.mensaje) throw new CampanaError(`El mensaje admite hasta ${LIMITES.mensaje} caracteres.`);

  const promo = texto(form, 'promocion');
  const idPromocion = promo === '' ? null : Number(promo);
  if (idPromocion !== null && !Number.isInteger(idPromocion)) throw new CampanaError('Elige una promoción de la lista.');

  // Botón opcional: sin enlace lleva a la tienda; sin texto dice "Ver en la tienda"
  const botonTexto = texto(form, 'boton_texto');
  const botonUrl = texto(form, 'boton_url');
  let boton: DatosCampana['boton'] = null;
  if (botonTexto || botonUrl) {
    if (botonTexto.length > LIMITES.botonTexto) throw new CampanaError(`El texto del botón admite hasta ${LIMITES.botonTexto} caracteres.`);
    if (botonUrl.length > LIMITES.botonUrl) throw new CampanaError('El enlace del botón es demasiado largo.');
    const url = botonUrl || urlTienda('/');
    let protocolo = '';
    try { protocolo = new URL(url).protocol; } catch { /* se rechaza abajo */ }
    if (protocolo !== 'https:' && protocolo !== 'http:') throw new CampanaError('El enlace del botón debe empezar con https://');
    boton = { texto: botonTexto || 'Ver en la tienda', url };
  }

  return { asunto, titulo, mensaje, idPromocion, boton };
}

// ── Destinatarios ───────────────────────────────────────────

// Dominios reservados que nunca reciben correo (RFC 2606 / 6761): los usan los datos de prueba
const DOMINIO_NO_ENTREGABLE = /(\.|^)(test|local|localhost|example|invalid)$|^example\.(com|net|org)$/i;

export const esCorreoEntregable = (correo: string): boolean =>
  CORREO_VALIDO.test(correo) && !DOMINIO_NO_ENTREGABLE.test(correo.split('@').pop() ?? '');

interface Destinatario {
  id: number;
  nombre: string;
  correo: string;
  token: string | null;
}

export interface Audiencia {
  destinatarios: Destinatario[];
  /** Clientes con cuenta en la tienda (sin contar al personal, que también puede tener ficha de cliente). */
  total: number;
  deBaja: number;
  inactivos: number;
  noEntregables: number;
}

/** Clientes con cuenta en la tienda a los que sí se les manda la campaña, y cuántos se quedan fuera y por qué. */
export async function audienciaCampana(): Promise<Audiencia> {
  const clientes = await db
    .select({
      id: Clientes.id,
      nombre: Clientes.nombre,
      correo: Clientes.correo,
      estado: Clientes.estado,
      recibe: Clientes.recibe_promociones,
      token: Clientes.token_baja,
      rol: Roles.nombre,
    })
    .from(Clientes)
    .innerJoin(Usuarios, eq(Clientes.id_usuario, Usuarios.id))
    .innerJoin(Roles, eq(Usuarios.id_rol, Roles.id))
    .orderBy(Clientes.id)
    .then((filas) => filas.filter((c) => roleFromName(c.rol) === 'cliente'));

  const audiencia: Audiencia = { destinatarios: [], total: clientes.length, deBaja: 0, inactivos: 0, noEntregables: 0 };
  for (const c of clientes) {
    if (c.estado.trim().toLowerCase() === 'inactivo') audiencia.inactivos++;
    else if (!c.recibe) audiencia.deBaja++;
    else if (!esCorreoEntregable(c.correo)) audiencia.noEntregables++;
    else audiencia.destinatarios.push({ id: c.id, nombre: c.nombre, correo: c.correo, token: c.token });
  }
  return audiencia;
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Token del enlace de baja del cliente; se genera la primera vez que se le manda una campaña. */
async function tokenBaja(cliente: Destinatario): Promise<string> {
  if (cliente.token) return cliente.token;
  await db.update(Clientes)
    .set({ token_baja: randomBytes(32).toString('base64url') })
    .where(and(eq(Clientes.id, cliente.id), isNull(Clientes.token_baja)));
  const [fila] = await db.select({ token: Clientes.token_baja }).from(Clientes).where(eq(Clientes.id, cliente.id));
  if (!fila?.token) throw new Error(`No se pudo generar el enlace de baja del cliente ${cliente.id}`);
  return fila.token;
}

// ── Correo ──────────────────────────────────────────────────

const pesos = (monto: number): string => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);
const fecha = (f: Date): string => new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long' }).format(f);
const primerNombre = (nombre: string): string => nombre.trim().split(/\s+/)[0] || nombre;

export const descuentoPromocion = (promo: Pick<Promocion, 'tipo_descuento' | 'valor'>): string =>
  promo.tipo_descuento === 'porcentaje' ? `${promo.valor}% de descuento` : `${pesos(promo.valor)} de descuento`;

function cajaPromocion(promo: Promocion): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border:2px solid #171717;background:#f7d21c;">
    <tr><td style="padding:16px 18px;">
      <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">${escaparHtml(promo.nombre)}</p>
      <p style="margin:6px 0 0;font-size:24px;font-weight:900;">${escaparHtml(descuentoPromocion(promo))}</p>
      ${promo.descripcion ? `<p style="margin:6px 0 0;font-size:14px;">${parrafoSeguro(promo.descripcion)}</p>` : ''}
      <p style="margin:8px 0 0;font-size:12px;">Válida del ${fecha(promo.fecha_inicio)} al ${fecha(promo.fecha_fin)}.</p>
    </td></tr>
  </table>`;
}

/** Arma el correo de la campaña para un cliente (exportado para las pruebas). */
export function correoCampana(
  datos: DatosCampana,
  promo: Promocion | null,
  cliente: { nombre: string; correo: string },
  bajaUrl: string,
): Correo {
  const saludo = cliente.nombre.trim() ? `Hola, ${primerNombre(cliente.nombre)}:` : 'Hola:';
  const parrafos = datos.mensaje.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const contenidoHtml = parrafos.map((p) => `<p style="margin:0 0 12px;">${parrafoSeguro(p)}</p>`).join('') + (promo ? cajaPromocion(promo) : '');
  const boton = datos.boton ?? { texto: 'Ir a la tienda', url: urlTienda('/') };

  const textoPromo = promo
    ? `\n\n${promo.nombre}: ${descuentoPromocion(promo)}. Válida del ${fecha(promo.fecha_inicio)} al ${fecha(promo.fecha_fin)}.`
    : '';
  return {
    para: cliente.correo,
    asunto: datos.asunto,
    html: plantillaCorreo({ titulo: datos.titulo, saludo, contenidoHtml, boton, bajaUrl }),
    texto: `${saludo}\n\n${parrafos.join('\n\n')}${textoPromo}\n\n${boton.texto}: ${boton.url}\n\n¿Ya no quieres promociones? Date de baja aquí: ${bajaUrl}`,
    encabezados: { 'List-Unsubscribe': `<${bajaUrl}>` },
  };
}

async function promocionDeCampana(id: number | null): Promise<Promocion | null> {
  if (id === null) return null;
  const promo = (await listarPromociones()).find((p) => p.id === id);
  if (!promo) throw new CampanaError('La promoción elegida ya no existe.');
  return promo;
}

/** Promociones que vale la pena anunciar: activas y que no han vencido. */
export async function promocionesAnunciables(): Promise<Promocion[]> {
  try {
    return (await listarPromociones()).filter((p) => p.vigencia === 'Vigente' || p.vigencia === 'Programada');
  } catch {
    return [];
  }
}

/** Correo del usuario del panel: valor inicial de "Enviar prueba a". */
export async function correoDeUsuario(idUsuario: number): Promise<{ nombre: string; correo: string } | null> {
  const [usuario] = await db.select({ nombre: Usuarios.nombre, correo: Usuarios.correo }).from(Usuarios).where(eq(Usuarios.id, idUsuario));
  return usuario ?? null;
}

/**
 * Nombre de quien recibe la prueba: el del cliente con ese correo o, si no es cliente, el de su cuenta.
 * Nunca el de quien la manda desde el panel; si el correo no está registrado, el saludo va sin nombre.
 */
async function nombreDelDestinatario(correo: string): Promise<string> {
  const [cliente] = await db.select({ nombre: Clientes.nombre }).from(Clientes).where(eq(Clientes.correo, correo)).limit(1);
  if (cliente) return cliente.nombre;
  const [usuario] = await db.select({ nombre: Usuarios.nombre }).from(Usuarios).where(eq(Usuarios.correo, correo)).limit(1);
  return usuario?.nombre ?? '';
}

/** Manda la campaña a un solo correo, para revisarla antes de enviarla a todos. Devuelve a dónde se mandó. */
export async function enviarPrueba(destino: string, datos: DatosCampana): Promise<string> {
  const para = destino.trim();
  if (!esCorreoEntregable(para)) throw new CampanaError('Escribe un correo válido para recibir la prueba.');
  const nombre = await nombreDelDestinatario(para);
  const correo = correoCampana(datos, await promocionDeCampana(datos.idPromocion), { nombre, correo: para }, urlTienda('/baja'));
  await enviarCorreo({ ...correo, asunto: `[Prueba] ${correo.asunto}` });
  return para;
}

// ── Envío ───────────────────────────────────────────────────

// Campañas que este proceso está enviando. Si el servidor se reinicia a media campaña, la que quedó en
// "Enviando" sin estar aquí se marca como Interrumpida. Vive en globalThis para sobrevivir a la recarga
// de módulos del servidor de desarrollo.
const globalCampanas = globalThis as unknown as { campanasActivas?: Set<number> };
const activas = (globalCampanas.campanasActivas ??= new Set<number>());

const pausa = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function marcarInterrumpidas(): Promise<void> {
  const enviando = await db.select({ id: CampanasCorreo.id }).from(CampanasCorreo).where(eq(CampanasCorreo.estado, 'Enviando'));
  for (const { id } of enviando) {
    if (!activas.has(id)) {
      await db.update(CampanasCorreo).set({ estado: 'Interrumpida', fecha_actualizacion: new Date() }).where(eq(CampanasCorreo.id, id));
    }
  }
}

/** Registra la campaña y empieza a mandarla en segundo plano. Devuelve a cuántos clientes se enviará. */
export async function iniciarCampana(idUsuario: number, datos: DatosCampana): Promise<number> {
  await marcarInterrumpidas();
  if (activas.size > 0) throw new CampanaError('Ya hay una campaña enviándose. Espera a que termine.');

  const promo = await promocionDeCampana(datos.idPromocion);
  const { destinatarios } = await audienciaCampana();
  if (destinatarios.length === 0) throw new CampanaError('No hay clientes a quienes enviar la campaña.');
  if (destinatarios.length > limiteCampana()) {
    throw new CampanaError(`La campaña llegaría a ${destinatarios.length} clientes y el límite es ${limiteCampana()} por envío (Gmail gratuito manda unos 500 al día).`);
  }

  const ahora = new Date();
  const [resultado] = await db.insert(CampanasCorreo).values({
    asunto: datos.asunto,
    titulo: datos.titulo,
    mensaje: datos.mensaje,
    id_promocion: datos.idPromocion,
    boton_texto: datos.boton?.texto ?? null,
    boton_url: datos.boton?.url ?? null,
    estado: 'Enviando',
    destinatarios: destinatarios.length,
    id_usuario: idUsuario,
    fecha_creacion: ahora,
    fecha_actualizacion: ahora,
  });
  const id = Number(resultado.insertId);
  activas.add(id);
  void enviarCampana(id, datos, promo, destinatarios);
  return destinatarios.length;
}

async function enviarCampana(id: number, datos: DatosCampana, promo: Promocion | null, destinatarios: Destinatario[]): Promise<void> {
  let enviados = 0;
  let fallidos = 0;
  const guardarAvance = (estado?: 'Enviada' | 'Con errores') =>
    db.update(CampanasCorreo)
      .set({ enviados, fallidos, fecha_actualizacion: new Date(), ...(estado ? { estado } : {}) })
      .where(eq(CampanasCorreo.id, id));

  try {
    for (const [i, cliente] of destinatarios.entries()) {
      try {
        const token = await tokenBaja(cliente);
        await enviarCorreo(correoCampana(datos, promo, cliente, urlTienda(`/baja?t=${token}`)));
        enviados++;
      } catch (error) {
        fallidos++;
        console.error(`[campaña ${id}] No se pudo enviar a ${cliente.correo}:`, error);
      }
      if ((i + 1) % 10 === 0) await guardarAvance();
      // Una pausa corta entre correos para no parecer spam ante el proveedor
      if (i < destinatarios.length - 1) await pausa(300);
    }
    await guardarAvance(fallidos > 0 ? 'Con errores' : 'Enviada');
    console.info(`[campaña ${id}] Terminó: ${enviados} enviados, ${fallidos} fallidos.`);
  } catch (error) {
    console.error(`[campaña ${id}] Se detuvo el envío:`, error);
    await guardarAvance('Con errores').catch(() => {});
  } finally {
    activas.delete(id);
  }
}

export interface CampanaResumen {
  id: number;
  asunto: string;
  estado: 'Enviando' | 'Enviada' | 'Con errores' | 'Interrumpida';
  destinatarios: number;
  enviados: number;
  fallidos: number;
  promocion: string | null;
  autor: string | null;
  fecha: Date;
}

/** Últimas campañas, de la más reciente a la más antigua. */
export async function listarCampanas(limite = 20): Promise<CampanaResumen[]> {
  await marcarInterrumpidas();
  return db
    .select({
      id: CampanasCorreo.id,
      asunto: CampanasCorreo.asunto,
      estado: CampanasCorreo.estado,
      destinatarios: CampanasCorreo.destinatarios,
      enviados: CampanasCorreo.enviados,
      fallidos: CampanasCorreo.fallidos,
      promocion: Promociones.nombre,
      autor: Usuarios.nombre,
      fecha: CampanasCorreo.fecha_creacion,
    })
    .from(CampanasCorreo)
    .leftJoin(Promociones, eq(CampanasCorreo.id_promocion, Promociones.id))
    .leftJoin(Usuarios, eq(CampanasCorreo.id_usuario, Usuarios.id))
    .orderBy(desc(CampanasCorreo.id))
    .limit(limite);
}

// ── Baja ────────────────────────────────────────────────────

/** Cliente dueño del enlace de baja, o null si el enlace no es válido. */
export async function clientePorToken(token: string): Promise<{ nombre: string; correo: string; recibe: boolean } | null> {
  if (!TOKEN.test(token)) return null;
  const [cliente] = await db
    .select({ nombre: Clientes.nombre, correo: Clientes.correo, recibe: Clientes.recibe_promociones })
    .from(Clientes)
    .where(eq(Clientes.token_baja, token));
  return cliente ?? null;
}

export async function cambiarSuscripcion(token: string, recibe: boolean): Promise<void> {
  if (!TOKEN.test(token)) return;
  await db.update(Clientes).set({ recibe_promociones: recibe }).where(eq(Clientes.token_baja, token));
}

/** "jona.hernandez@gmail.com" → "jo•••@gmail.com", para no mostrar el correo completo en la página de baja. */
export const ocultarCorreo = (correo: string): string => {
  const [usuario, dominio] = correo.split('@');
  return `${usuario.slice(0, 2)}•••@${dominio ?? ''}`;
};
