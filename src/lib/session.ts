import { createHash, randomBytes } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { eq, lt } from 'drizzle-orm';
import { db } from '../db/db';
import { Sesiones } from '../db/schema';

export const SESSION_COOKIE = 'sportenis_session';
const SESSION_DAYS = 7;

// En la base solo se guarda el hash del token; el token real vive únicamente en la cookie.
export const hashSessionToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const iniciarSesion = async (cookies: AstroCookies, userId: number): Promise<void> => {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.delete(Sesiones).where(lt(Sesiones.fecha_expiracion, now));
  await db.insert(Sesiones).values({
    token_hash: hashSessionToken(token),
    id_usuario: userId,
    fecha_creacion: now,
    fecha_expiracion: expires,
  });

  cookies.set(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
    expires,
  });
};

export const cerrarSesion = async (cookies: AstroCookies): Promise<void> => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(Sesiones).where(eq(Sesiones.token_hash, hashSessionToken(token)));
  cookies.delete(SESSION_COOKIE, { path: '/' });
};

export const cerrarSesionesDeUsuario = async (userId: number): Promise<void> => {
  await db.delete(Sesiones).where(eq(Sesiones.id_usuario, userId));
};
