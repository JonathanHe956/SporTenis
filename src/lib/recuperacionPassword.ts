// "¿Olvidaste tu contraseña?" (Etapa 4, 4.3). El cliente pide un enlace con su correo y le llega un
// enlace de un solo uso que vence en 30 minutos. En la base solo queda el hash del token.
//
// La respuesta al pedir el enlace es siempre la misma, exista o no la cuenta: así la página no sirve
// para averiguar qué correos están registrados.
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { db } from '../db/db';
import { RecuperacionesPassword, Usuarios } from '../db/schema';
import { isUsuarioActivo } from './auth';
import { CORREO_VALIDO, enviarEnSegundoPlano, plantillaCorreo, urlTienda } from './correo';
import { hashPassword } from './password';
import { cerrarSesionesDeUsuario } from './session';

export const MINUTOS_ENLACE = 30;
/** Enlaces que se pueden pedir por cuenta en una hora, para no llenar el buzón de nadie. */
export const MAX_ENLACES_POR_HORA = 3;

/** Error que se le muestra tal cual al cliente. */
export class RecuperacionError extends Error {}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Token aleatorio para la URL (43 caracteres base64url, 256 bits). */
export const generarToken = (): string => randomBytes(32).toString('base64url');

const TOKEN_VALIDO = /^[A-Za-z0-9_-]{43}$/;
export const formatoTokenValido = (token: string): boolean => TOKEN_VALIDO.test(token);

/** Mismas reglas de contraseña que el registro. */
export function validarNuevaPassword(password: string, confirmacion: string): void {
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new RecuperacionError('La contraseña debe tener 8+ caracteres, mayúscula, número y símbolo.');
  }
  if (password.length > 200) throw new RecuperacionError('La contraseña es demasiado larga.');
  if (password !== confirmacion) throw new RecuperacionError('Las contraseñas no coinciden.');
}

/** Un enlace sirve si no se ha usado y no ha vencido. */
export const enlaceVigente = (
  registro: { fecha_expiracion: Date; fecha_uso: Date | null },
  ahora = new Date(),
): boolean => registro.fecha_uso === null && registro.fecha_expiracion.getTime() > ahora.getTime();

/**
 * Crea el enlace y lo manda por correo si la cuenta existe y está activa. Si no existe no hace nada,
 * pero el llamador responde lo mismo en ambos casos.
 */
export async function solicitarRecuperacion(correoEscrito: string): Promise<void> {
  const correo = correoEscrito.trim().toLowerCase();
  if (correo.length > 255 || !CORREO_VALIDO.test(correo)) throw new RecuperacionError('Ingresa un correo válido.');

  const [usuario] = await db
    .select({ id: Usuarios.id, nombre: Usuarios.nombre, estado: Usuarios.estado })
    .from(Usuarios)
    .where(eq(Usuarios.correo, correo));
  if (!usuario || !isUsuarioActivo(usuario.estado)) return;

  const ahora = new Date();
  const haceUnaHora = new Date(ahora.getTime() - 60 * 60 * 1000);
  const recientes = await db
    .select({ id: RecuperacionesPassword.id })
    .from(RecuperacionesPassword)
    .where(and(eq(RecuperacionesPassword.id_usuario, usuario.id), gt(RecuperacionesPassword.fecha_creacion, haceUnaHora)));
  if (recientes.length >= MAX_ENLACES_POR_HORA) return;

  // Limpieza: enlaces vencidos de cualquier cuenta ya no sirven
  await db.delete(RecuperacionesPassword).where(lt(RecuperacionesPassword.fecha_expiracion, haceUnaHora));

  const token = generarToken();
  await db.insert(RecuperacionesPassword).values({
    id_usuario: usuario.id,
    token_hash: hashToken(token),
    fecha_creacion: ahora,
    fecha_expiracion: new Date(ahora.getTime() + MINUTOS_ENLACE * 60 * 1000),
  });

  const url = urlTienda(`/restablecer-password?token=${token}`);
  const saludo = `Hola, ${usuario.nombre.split(' ')[0]}:`;
  // En segundo plano: la respuesta tarda lo mismo exista o no la cuenta
  enviarEnSegundoPlano('enlace de recuperación de contraseña', async () => ({
    para: correo,
    asunto: 'Restablece tu contraseña de SporTenis',
    html: plantillaCorreo({
      titulo: 'Restablece tu contraseña',
      saludo,
      contenidoHtml: `<p>Recibimos una solicitud para cambiar la contraseña de tu cuenta. Usa el botón para elegir una nueva.</p>
        <p>El enlace vence en ${MINUTOS_ENLACE} minutos y solo funciona una vez. Si no fuiste tú, ignora este correo: tu contraseña no cambia.</p>`,
      boton: { texto: 'Elegir nueva contraseña', url },
      pie: 'Por seguridad, al cambiar la contraseña se cerrará tu sesión en todos tus dispositivos.',
    }),
    texto: `${saludo}\n\nPara elegir una nueva contraseña abre este enlace (vence en ${MINUTOS_ENLACE} minutos):\n${url}\n\nSi no fuiste tú, ignora este correo.`,
  }));
}

/** Revisa el enlace antes de mostrar el formulario. */
export async function enlaceEsValido(token: string): Promise<boolean> {
  if (!formatoTokenValido(token)) return false;
  const [registro] = await db
    .select({ fecha_expiracion: RecuperacionesPassword.fecha_expiracion, fecha_uso: RecuperacionesPassword.fecha_uso })
    .from(RecuperacionesPassword)
    .where(eq(RecuperacionesPassword.token_hash, hashToken(token)));
  return Boolean(registro && enlaceVigente(registro));
}

/**
 * Cambia la contraseña con un enlace vigente. Marca el enlace como usado (solo gana una petición
 * aunque lleguen dos a la vez), invalida los demás enlaces de la cuenta y cierra sus sesiones.
 */
export async function restablecerPassword(token: string, password: string, confirmacion: string): Promise<void> {
  if (!formatoTokenValido(token)) throw new RecuperacionError('El enlace no es válido. Pide uno nuevo.');
  validarNuevaPassword(password, confirmacion);

  const ahora = new Date();
  const passwordHash = await hashPassword(password);

  const idUsuario = await db.transaction(async (tx) => {
    const [registro] = await tx
      .select({ id: RecuperacionesPassword.id, id_usuario: RecuperacionesPassword.id_usuario })
      .from(RecuperacionesPassword)
      .where(eq(RecuperacionesPassword.token_hash, hashToken(token)));
    if (!registro) throw new RecuperacionError('El enlace no es válido. Pide uno nuevo.');

    const [marcado] = await tx
      .update(RecuperacionesPassword)
      .set({ fecha_uso: ahora })
      .where(and(
        eq(RecuperacionesPassword.id, registro.id),
        isNull(RecuperacionesPassword.fecha_uso),
        gt(RecuperacionesPassword.fecha_expiracion, ahora),
      ));
    if (marcado.affectedRows === 0) throw new RecuperacionError('El enlace ya se usó o venció. Pide uno nuevo.');

    await tx.update(Usuarios).set({ password_hash: passwordHash }).where(eq(Usuarios.id, registro.id_usuario));
    // Los otros enlaces que el cliente haya pedido dejan de servir
    await tx
      .update(RecuperacionesPassword)
      .set({ fecha_uso: ahora })
      .where(and(eq(RecuperacionesPassword.id_usuario, registro.id_usuario), isNull(RecuperacionesPassword.fecha_uso)));

    return registro.id_usuario;
  });

  // Si alguien más conocía la contraseña anterior, pierde el acceso
  await cerrarSesionesDeUsuario(idUsuario);
}
