// "¿Olvidaste tu contraseña?" (Etapa 4, 4.3). Igual que al registrarse: el cliente escribe su correo,
// le llega un código de 6 dígitos y con él elige una contraseña nueva en el mismo navegador.
//
// El navegador se reconoce por una cookie con un token aleatorio; en la base solo quedan el hash del
// token y el del código ligado a ese token (migración 0027), nunca el código en claro.
//
// Si el correo no tiene cuenta se guarda igual una solicitud, pero sin mandar nada: la página responde
// lo mismo exista o no la cuenta, y el código nunca funciona.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { RecuperacionesPassword, Usuarios } from '../db/schema';
import { isUsuarioActivo } from './auth';
import { CORREO_VALIDO, enviarCorreo, escaparHtml, plantillaCorreo } from './correo';
import { hashPassword } from './password';
import { cerrarSesionesDeUsuario } from './session';
import { generarCodigo, hashCodigo } from './verificacionCorreo';

export const RECUPERACION_COOKIE = 'sportenis_recuperacion';
export const MINUTOS_CODIGO = 10;
export const SEGUNDOS_REENVIO = 60;
export const MAX_INTENTOS = 5;
/** Códigos que se pueden pedir por correo en una hora, para no llenar el buzón de nadie. */
export const MAX_CODIGOS_POR_HORA = 5;
/** Tiempo que la cookie recuerda la solicitud (alcanza para pedir varios códigos). */
const MINUTOS_SOLICITUD = 30;

/** Error que se le muestra tal cual al cliente. */
export class RecuperacionError extends Error {}

type Solicitud = typeof RecuperacionesPassword.$inferSelect;

const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex');

/** Mismas reglas de contraseña que el registro. */
export function validarNuevaPassword(password: string, confirmacion: string): void {
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new RecuperacionError('La contraseña debe tener 8+ caracteres, mayúscula, número y símbolo.');
  }
  if (password.length > 200) throw new RecuperacionError('La contraseña es demasiado larga.');
  if (password !== confirmacion) throw new RecuperacionError('Las contraseñas no coinciden.');
}

/** Un código sirve si no se ha usado y no ha vencido. */
export const codigoVigente = (
  solicitud: { fecha_expiracion: Date; fecha_uso: Date | null },
  ahora = new Date(),
): boolean => solicitud.fecha_uso === null && solicitud.fecha_expiracion.getTime() > ahora.getTime();

export const segundosParaReenviar = (solicitud: Pick<Solicitud, 'fecha_creacion'>, ahora = new Date()): number =>
  Math.max(0, Math.ceil((solicitud.fecha_creacion.getTime() + SEGUNDOS_REENVIO * 1000 - ahora.getTime()) / 1000));

async function enviarCodigo(nombre: string, correo: string, codigo: string): Promise<void> {
  const saludo = `Hola, ${nombre.split(' ')[0]}:`;
  try {
    await enviarCorreo({
      para: correo,
      asunto: `${codigo} es tu código para restablecer tu contraseña de SporTenis`,
      html: plantillaCorreo({
        titulo: 'Restablece tu contraseña',
        saludo,
        contenidoHtml: `<p>Recibimos una solicitud para cambiar la contraseña de tu cuenta. Escribe este código en la página de recuperación:</p>
          <p style="margin:20px 0;font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:10px;">${escaparHtml(codigo)}</p>
          <p>El código vence en ${MINUTOS_CODIGO} minutos y solo funciona una vez. Si no fuiste tú, ignora este correo: tu contraseña no cambia.</p>`,
        pie: 'Nunca te pediremos este código por teléfono ni por mensaje. Al cambiar la contraseña se cerrará tu sesión en todos tus dispositivos.',
      }),
      texto: `${saludo}\n\nTu código para restablecer tu contraseña de SporTenis es ${codigo}. Vence en ${MINUTOS_CODIGO} minutos.\n\nSi no fuiste tú, ignora este correo.`,
    });
  } catch (error) {
    console.error(`[recuperación] No se pudo enviar el código a ${correo}:`, error);
    throw new RecuperacionError('No pudimos enviar el código a ese correo. Intenta de nuevo en unos minutos.');
  }
}

const leerToken = (cookies: AstroCookies): string | null => {
  const token = cookies.get(RECUPERACION_COOKIE)?.value;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
};

/** Solicitud vigente de este navegador (sin usar y dentro de los 30 minutos de la cookie). */
async function buscarSolicitud(token: string | null): Promise<Solicitud | null> {
  if (!token) return null;
  const [solicitud] = await db.select().from(RecuperacionesPassword).where(eq(RecuperacionesPassword.token_hash, sha256(token)));
  if (!solicitud || solicitud.fecha_uso !== null) return null;
  if (solicitud.fecha_creacion.getTime() < Date.now() - MINUTOS_SOLICITUD * 60 * 1000) return null;
  return solicitud;
}

/**
 * Manda un código al correo (si tiene una cuenta activa) y deja la cookie en este navegador.
 * Cada código nuevo invalida los anteriores de ese correo.
 */
export async function solicitarRecuperacion(cookies: AstroCookies, correoEscrito: string): Promise<void> {
  const correo = correoEscrito.trim().toLowerCase();
  if (correo.length > 255 || !CORREO_VALIDO.test(correo)) throw new RecuperacionError('Ingresa un correo válido.');

  const ahora = new Date();
  const haceUnaHora = new Date(ahora.getTime() - 60 * 60 * 1000);
  // Limpieza: solicitudes de hace más de una hora de cualquier correo ya no sirven
  await db.delete(RecuperacionesPassword).where(lt(RecuperacionesPassword.fecha_creacion, haceUnaHora));

  // Los límites cuentan por correo, exista o no la cuenta
  const recientes = await db
    .select({ fecha_creacion: RecuperacionesPassword.fecha_creacion })
    .from(RecuperacionesPassword)
    .where(and(eq(RecuperacionesPassword.correo, correo), gt(RecuperacionesPassword.fecha_creacion, haceUnaHora)))
    .orderBy(desc(RecuperacionesPassword.fecha_creacion));
  if (recientes.length >= MAX_CODIGOS_POR_HORA) {
    throw new RecuperacionError('Pediste demasiados códigos para este correo. Intenta de nuevo en una hora.');
  }
  const espera = recientes[0] ? segundosParaReenviar(recientes[0], ahora) : 0;
  if (espera > 0) throw new RecuperacionError(`Espera ${espera} segundos antes de pedir otro código.`);

  const [usuario] = await db
    .select({ id: Usuarios.id, nombre: Usuarios.nombre, estado: Usuarios.estado })
    .from(Usuarios)
    .where(eq(Usuarios.correo, correo));
  const cuenta = usuario && isUsuarioActivo(usuario.estado) ? usuario : null;

  const token = randomBytes(32).toString('base64url');
  const codigo = generarCodigo();
  // Primero el correo: si el proveedor lo rechaza no queda nada guardado y el cliente lo sabe
  if (cuenta) await enviarCodigo(cuenta.nombre, correo, codigo);

  await db
    .update(RecuperacionesPassword)
    .set({ fecha_uso: ahora })
    .where(and(eq(RecuperacionesPassword.correo, correo), isNull(RecuperacionesPassword.fecha_uso)));
  await db.insert(RecuperacionesPassword).values({
    id_usuario: cuenta?.id ?? null,
    correo,
    token_hash: sha256(token),
    codigo_hash: hashCodigo(codigo, token),
    intentos: 0,
    fecha_creacion: ahora,
    fecha_expiracion: new Date(ahora.getTime() + MINUTOS_CODIGO * 60 * 1000),
  });

  cookies.set(RECUPERACION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
    maxAge: MINUTOS_SOLICITUD * 60,
  });
}

/** Lo que la página del código necesita mostrar, o null si este navegador no tiene solicitud vigente. */
export async function estadoRecuperacion(
  cookies: AstroCookies,
): Promise<{ correo: string; segundosParaReenviar: number; vencido: boolean } | null> {
  const solicitud = await buscarSolicitud(leerToken(cookies));
  if (!solicitud) return null;
  return {
    correo: solicitud.correo,
    segundosParaReenviar: segundosParaReenviar(solicitud),
    vencido: !codigoVigente(solicitud),
  };
}

const SOLICITUD_EXPIRADA = 'Tu solicitud expiró. Vuelve a escribir tu correo para recibir un código.';

/** Manda otro código al mismo correo; el anterior deja de servir. */
export async function reenviarCodigo(cookies: AstroCookies): Promise<void> {
  const solicitud = await buscarSolicitud(leerToken(cookies));
  if (!solicitud) throw new RecuperacionError(SOLICITUD_EXPIRADA);
  await solicitarRecuperacion(cookies, solicitud.correo);
}

/**
 * Revisa el código y cambia la contraseña. Marca la solicitud como usada (solo gana una petición
 * aunque lleguen dos a la vez), invalida las demás de la cuenta y cierra todas sus sesiones.
 */
export async function restablecerPassword(
  cookies: AstroCookies,
  codigoEscrito: string,
  password: string,
  confirmacion: string,
): Promise<void> {
  const token = leerToken(cookies);
  const solicitud = await buscarSolicitud(token);
  if (!token || !solicitud) throw new RecuperacionError(SOLICITUD_EXPIRADA);

  const codigo = codigoEscrito.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(codigo)) throw new RecuperacionError('Escribe los 6 dígitos del código.');
  // La contraseña se valida antes de gastar un intento del código
  validarNuevaPassword(password, confirmacion);
  if (!codigoVigente(solicitud)) throw new RecuperacionError('El código venció. Pide uno nuevo.');

  // El intento se cuenta antes de comparar, en una sola sentencia: varias peticiones a la vez no
  // pueden pasarse del límite para adivinar el código.
  const [conteo] = await db
    .update(RecuperacionesPassword)
    .set({ intentos: sql`${RecuperacionesPassword.intentos} + 1` })
    .where(and(eq(RecuperacionesPassword.id, solicitud.id), lt(RecuperacionesPassword.intentos, MAX_INTENTOS)));
  if (conteo.affectedRows === 0) {
    throw new RecuperacionError('Superaste los intentos permitidos. Pide un código nuevo.');
  }

  const esperado = Buffer.from(solicitud.codigo_hash, 'hex');
  const recibido = Buffer.from(hashCodigo(codigo, token), 'hex');
  const coincide = esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
  // Sin cuenta, el código nunca funciona (y el mensaje es el mismo que con uno equivocado)
  if (!coincide || solicitud.id_usuario === null) {
    const restantes = MAX_INTENTOS - solicitud.intentos - 1;
    throw new RecuperacionError(
      restantes > 0
        ? `Código incorrecto. Te ${restantes === 1 ? 'queda 1 intento' : `quedan ${restantes} intentos`}.`
        : 'Código incorrecto. Superaste los intentos permitidos: pide un código nuevo.',
    );
  }

  const idUsuario = solicitud.id_usuario;
  const ahora = new Date();
  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    const [marcado] = await tx
      .update(RecuperacionesPassword)
      .set({ fecha_uso: ahora })
      .where(and(
        eq(RecuperacionesPassword.id, solicitud.id),
        isNull(RecuperacionesPassword.fecha_uso),
        gt(RecuperacionesPassword.fecha_expiracion, ahora),
      ));
    if (marcado.affectedRows === 0) throw new RecuperacionError('El código ya se usó o venció. Pide uno nuevo.');

    await tx.update(Usuarios).set({ password_hash: passwordHash }).where(eq(Usuarios.id, idUsuario));
    // Los otros códigos que el cliente haya pedido dejan de servir
    await tx
      .update(RecuperacionesPassword)
      .set({ fecha_uso: ahora })
      .where(and(eq(RecuperacionesPassword.id_usuario, idUsuario), isNull(RecuperacionesPassword.fecha_uso)));
  });

  cookies.delete(RECUPERACION_COOKIE, { path: '/' });
  // Si alguien más conocía la contraseña anterior, pierde el acceso
  await cerrarSesionesDeUsuario(idUsuario);
}
