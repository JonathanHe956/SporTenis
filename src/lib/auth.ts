import { eq } from 'drizzle-orm';
import { db } from '../db/db';
import { Usuarios } from '../db/schema';

export const userRoles = ['administrador', 'vendedor', 'cliente'] as const;
export type UserRole = (typeof userRoles)[number];

export interface AuthenticatedUser {
  id: number;
  role: UserRole;
}

const roleById: Readonly<Record<number, UserRole>> = {
  1: 'administrador',
  2: 'vendedor',
  3: 'cliente',
};

export const canAccessCrm = (role: UserRole | null | undefined): boolean =>
  role === 'administrador' || role === 'vendedor';

export const getAuthenticatedUser = async (
  sessionId: string | undefined,
): Promise<AuthenticatedUser | null> => {
  if (!sessionId || !/^\d+$/.test(sessionId)) return null;

  const userResult = await db.select().from(Usuarios).where(eq(Usuarios.id, Number(sessionId)));
  const user = userResult[0];
  const role = user ? roleById[user.id_rol] : undefined;

  return user && role ? { id: user.id, role } : null;
};