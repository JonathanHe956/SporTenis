// Verificación del correo al registrarse. La cuenta (Usuarios + Clientes) no existe hasta que el
// cliente escribe el código de 6 dígitos que le mandamos: así solo se registran correos que de verdad
// son suyos. Mientras tanto los datos esperan en VerificacionesCorreo (migración 0020).
//
// El navegador que llenó el formulario se reconoce por una cookie con un token aleatorio; en la base
// solo queda su hash, y el código se guarda ligado a ese token, nunca en claro.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { Clientes, Usuarios, VerificacionesCorreo } from '../db/schema';
import { getOrCreateRoleId } from './auth';
import { CORREO_VALIDO, enviarCorreo, escaparHtml, plantillaCorreo } from './correo';
import { hashPassword } from './password';

export const VERIFICACION_COOKIE = 'sportenis_verificacion';
export const MINUTOS_CODIGO = 10;
export const SEGUNDOS_REENVIO = 60;
export const MAX_INTENTOS = 5;
const MAX_ENVIOS = 5;
const HORAS_REGISTRO = 24;

/** Error que se le muestra tal cual al cliente. */
export class VerificacionError extends Error {}

type RegistroPendiente = typeof VerificacionesCorreo.$inferSelect;

export interface DatosRegistro {
  nombre: string;
  telefono: string;
  correo: string;
  password: string;
}

const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex');

export const generarCodigo = (): string => randomInt(0, 1_000_000).toString().padStart(6, '0');

/** El hash del código depende del token de la cookie: sin ella no sirve aunque se filtre la base. */
export const hashCodigo = (codigo: string, token: string): string => sha256(`${token}:${codigo}`);

/** "juanperez@gmail.com" → "ju•••••••@gmail.com" */
export const enmascararCorreo = (correo: string): string => {
  const arroba = correo.lastIndexOf('@');
  if (arroba < 1) return correo;
  const usuario = correo.slice(0, arroba);
  const visibles = usuario.length <= 2 ? 1 : 2;
  return `${usuario.slice(0, visibles)}${'•'.repeat(Math.max(usuario.length - visibles, 3))}${correo.slice(arroba)}`;
};

const NOMBRE_VALIDO = /^[A-Za-zÁÉÍÓÚáéíóúÜüÑñ\s]{2,}$/;

/** Mismas reglas que valida el formulario en el navegador, ahora también en el servidor. */
export function validarRegistro(form: FormData): DatosRegistro {
  const texto = (campo: string) => form.get(campo)?.toString().trim() ?? '';
  const nombre = texto('nombre');
  const apellidos = texto('apellidos');
  const telefono = texto('telefono');
  const correo = texto('correo').toLowerCase();
  const password = form.get('password')?.toString() ?? '';

  if (!NOMBRE_VALIDO.test(nombre) || !NOMBRE_VALIDO.test(apellidos)) {
    throw new VerificacionError('El nombre y los apellidos solo pueden contener letras y espacios.');
  }
  if (!/^\d{10}$/.test(telefono)) throw new VerificacionError('Ingresa un número de teléfono de 10 dígitos.');
  if (correo.length > 255 || !CORREO_VALIDO.test(correo)) throw new VerificacionError('Ingresa un correo válido.');
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new VerificacionError('La contraseña debe tener 8+ caracteres, mayúscula, número y símbolo.');
  }
  if (password !== (form.get('confirmPassword')?.toString() ?? '')) {
    throw new VerificacionError('Las contraseñas no coinciden.');
  }

  return { nombre: `${nombre} ${apellidos}`.replace(/\s+/g, ' '), telefono, correo, password };
}

const correoYaRegistrado = async (correo: string): Promise<boolean> =>
  (await db.select({ id: Usuarios.id }).from(Usuarios).where(eq(Usuarios.correo, correo)).limit(1)).length > 0;

const segundosParaReenviar = (registro: Pick<RegistroPendiente, 'fecha_envio'>, ahora = new Date()): number =>
  Math.max(0, Math.ceil((registro.fecha_envio.getTime() + SEGUNDOS_REENVIO * 1000 - ahora.getTime()) / 1000));

/** Revisa que este correo pueda recibir otro código ahora mismo. */
function revisarLimiteEnvios(registro: RegistroPendiente): void {
  if (registro.envios >= MAX_ENVIOS) {
    throw new VerificacionError('Pediste demasiados códigos para este correo. Intenta de nuevo mañana.');
  }
  const espera = segundosParaReenviar(registro);
  if (espera > 0) throw new VerificacionError(`Espera ${espera} segundos antes de pedir otro código.`);
}

async function enviarCodigo(nombre: string, correo: string, codigo: string): Promise<void> {
  const saludo = `Hola, ${nombre.split(' ')[0]}:`;
  try {
    await enviarCorreo({
      para: correo,
      asunto: `${codigo} es tu código de verificación de SporTenis`,
      html: plantillaCorreo({
        titulo: 'Confirma tu correo',
        saludo,
        contenidoHtml: `<p>Escribe este código en la página de registro para terminar de crear tu cuenta:</p>
          <p style="margin:20px 0;font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:10px;">${escaparHtml(codigo)}</p>
          <p>El código vence en ${MINUTOS_CODIGO} minutos. Si no fuiste tú, ignora este correo: sin el código nadie puede crear una cuenta con tu dirección.</p>`,
        pie: 'Nunca te pediremos este código por teléfono ni por mensaje.',
      }),
      texto: `${saludo}\n\nTu código de verificación de SporTenis es ${codigo}. Vence en ${MINUTOS_CODIGO} minutos.\n\nSi no fuiste tú, ignora este correo.`,
    });
  } catch (error) {
    console.error(`[verificación] No se pudo enviar el código a ${correo}:`, error);
    throw new VerificacionError('No pudimos enviar el código a ese correo. Revisa que esté bien escrito e intenta de nuevo.');
  }
}

const guardarCookie = (cookies: AstroCookies, token: string): void => {
  cookies.set(VERIFICACION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
    maxAge: HORAS_REGISTRO * 60 * 60,
  });
};

/**
 * Guarda los datos del formulario y manda el código. La cuenta todavía no se crea.
 * Si ese correo ya tenía un registro en espera (p. ej. corrigió un dato), se reemplaza.
 */
export async function iniciarRegistro(cookies: AstroCookies, datos: DatosRegistro): Promise<void> {
  if (await correoYaRegistrado(datos.correo)) {
    throw new VerificacionError('Este correo electrónico ya está registrado.');
  }

  const ahora = new Date();
  await db.delete(VerificacionesCorreo)
    .where(lt(VerificacionesCorreo.fecha_creacion, new Date(ahora.getTime() - HORAS_REGISTRO * 3600 * 1000)));

  const [previo] = await db.select().from(VerificacionesCorreo).where(eq(VerificacionesCorreo.correo, datos.correo));
  if (previo) revisarLimiteEnvios(previo);

  const token = randomBytes(32).toString('base64url');
  const codigo = generarCodigo();
  // Primero el correo: si el proveedor lo rechaza no queda nada guardado y puede corregir la dirección
  await enviarCodigo(datos.nombre, datos.correo, codigo);

  const valores = {
    token_hash: sha256(token),
    nombre: datos.nombre,
    telefono: datos.telefono,
    password_hash: await hashPassword(datos.password),
    codigo_hash: hashCodigo(codigo, token),
    intentos: 0,
    fecha_envio: ahora,
    fecha_expiracion: new Date(ahora.getTime() + MINUTOS_CODIGO * 60 * 1000),
  };
  if (previo) {
    await db.update(VerificacionesCorreo)
      .set({ ...valores, envios: previo.envios + 1 })
      .where(eq(VerificacionesCorreo.id, previo.id));
  } else {
    await db.insert(VerificacionesCorreo).values({ ...valores, correo: datos.correo, envios: 1, fecha_creacion: ahora });
  }

  guardarCookie(cookies, token);
}

const leerToken = (cookies: AstroCookies): string | null => {
  const token = cookies.get(VERIFICACION_COOKIE)?.value;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
};

async function buscarPendiente(token: string | null): Promise<RegistroPendiente | null> {
  if (!token) return null;
  const [registro] = await db.select().from(VerificacionesCorreo).where(eq(VerificacionesCorreo.token_hash, sha256(token)));
  if (!registro || registro.fecha_creacion.getTime() < Date.now() - HORAS_REGISTRO * 3600 * 1000) return null;
  return registro;
}

/** Lo que la página de verificación necesita mostrar, o null si no hay registro en espera. */
export async function estadoVerificacion(cookies: AstroCookies): Promise<{ correo: string; segundosParaReenviar: number } | null> {
  const registro = await buscarPendiente(leerToken(cookies));
  return registro ? { correo: registro.correo, segundosParaReenviar: segundosParaReenviar(registro) } : null;
}

const REGISTRO_EXPIRADO = 'Tu registro expiró. Vuelve a llenar el formulario.';

export async function reenviarCodigo(cookies: AstroCookies): Promise<void> {
  const token = leerToken(cookies);
  const registro = await buscarPendiente(token);
  if (!token || !registro) throw new VerificacionError(REGISTRO_EXPIRADO);
  revisarLimiteEnvios(registro);

  const codigo = generarCodigo();
  await enviarCodigo(registro.nombre, registro.correo, codigo);
  const ahora = new Date();
  await db.update(VerificacionesCorreo)
    .set({
      codigo_hash: hashCodigo(codigo, token),
      intentos: 0,
      envios: sql`${VerificacionesCorreo.envios} + 1`,
      fecha_envio: ahora,
      fecha_expiracion: new Date(ahora.getTime() + MINUTOS_CODIGO * 60 * 1000),
    })
    .where(eq(VerificacionesCorreo.id, registro.id));
}

/**
 * Revisa el código y, si es correcto, crea la cuenta del cliente.
 * Devuelve el usuario nuevo para iniciar su sesión.
 */
export async function confirmarCodigo(
  cookies: AstroCookies,
  codigoEscrito: string,
): Promise<{ idUsuario: number; nombre: string; correo: string }> {
  const token = leerToken(cookies);
  const registro = await buscarPendiente(token);
  if (!token || !registro) throw new VerificacionError(REGISTRO_EXPIRADO);

  const codigo = codigoEscrito.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(codigo)) throw new VerificacionError('Escribe los 6 dígitos del código.');
  if (registro.fecha_expiracion.getTime() < Date.now()) {
    throw new VerificacionError('El código venció. Pide uno nuevo.');
  }

  // El intento se cuenta antes de comparar, en una sola sentencia: varias peticiones a la vez no
  // pueden pasarse del límite para adivinar el código.
  const [conteo] = await db.update(VerificacionesCorreo)
    .set({ intentos: sql`${VerificacionesCorreo.intentos} + 1` })
    .where(and(eq(VerificacionesCorreo.id, registro.id), lt(VerificacionesCorreo.intentos, MAX_INTENTOS)));
  if (conteo.affectedRows === 0) {
    throw new VerificacionError('Superaste los intentos permitidos. Pide un código nuevo.');
  }

  const esperado = Buffer.from(registro.codigo_hash, 'hex');
  const recibido = Buffer.from(hashCodigo(codigo, token), 'hex');
  if (esperado.length !== recibido.length || !timingSafeEqual(esperado, recibido)) {
    const restantes = MAX_INTENTOS - registro.intentos - 1;
    throw new VerificacionError(
      restantes > 0
        ? `Código incorrecto. Te ${restantes === 1 ? 'queda 1 intento' : `quedan ${restantes} intentos`}.`
        : 'Código incorrecto. Superaste los intentos permitidos: pide un código nuevo.',
    );
  }

  const idRolCliente = await getOrCreateRoleId('cliente');
  const idUsuario = await db.transaction(async (tx) => {
    const [existente] = await tx.select({ id: Usuarios.id }).from(Usuarios).where(eq(Usuarios.correo, registro.correo));
    if (existente) throw new VerificacionError('Este correo electrónico ya está registrado. Inicia sesión.');

    const ahora = new Date();
    const [usuario] = await tx.insert(Usuarios).values({
      id_rol: idRolCliente,
      nombre: registro.nombre,
      correo: registro.correo,
      password_hash: registro.password_hash,
      estado: 'activo',
      fecha_creacion: ahora,
    });
    const id = Number(usuario.insertId);

    // Si el CRM ya lo tenía como cliente (capturado a mano, sin cuenta), se liga en vez de duplicarlo
    const [clienteCrm] = await tx.select({ id: Clientes.id, id_usuario: Clientes.id_usuario, telefono: Clientes.telefono })
      .from(Clientes).where(eq(Clientes.correo, registro.correo));
    if (clienteCrm && clienteCrm.id_usuario === null) {
      await tx.update(Clientes)
        .set({ id_usuario: id, telefono: clienteCrm.telefono || registro.telefono })
        .where(eq(Clientes.id, clienteCrm.id));
    } else if (!clienteCrm) {
      await tx.insert(Clientes).values({
        id_usuario: id,
        id_etapa_crm: 1, // Prospecto
        nombre: registro.nombre,
        correo: registro.correo,
        telefono: registro.telefono,
        estado: 'Activo',
        fecha_registro: ahora,
      });
    }

    await tx.delete(VerificacionesCorreo).where(eq(VerificacionesCorreo.id, registro.id));
    return id;
  });

  cookies.delete(VERIFICACION_COOKIE, { path: '/' });
  return { idUsuario, nombre: registro.nombre, correo: registro.correo };
}
