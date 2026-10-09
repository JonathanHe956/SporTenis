import { and, eq, gt } from 'drizzle-orm';
import { db } from '../db/db';
import { Roles, Sesiones, Usuarios } from '../db/schema';
import { hashSessionToken } from './session';

export const userRoles = ['administrador', 'vendedor', 'cliente', 'logistica'] as const;
export type UserRole = (typeof userRoles)[number];

export interface AuthenticatedUser {
  id: number;
  role: UserRole;
  nombre: string;
}

// Nombres aceptados en la tabla Roles para cada rol de la aplicación
const roleAliases: Readonly<Record<string, UserRole>> = {
  administrador: 'administrador',
  admin: 'administrador',
  vendedor: 'vendedor',
  ventas: 'vendedor',
  logistica: 'logistica',
  cliente: 'cliente',
};

// El rol se resuelve por el nombre guardado en Roles: los ids cambian de una base a otra.
export const roleFromName = (nombre: string | null | undefined): UserRole | undefined =>
  roleAliases[(nombre ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()];

export const getRoleById = async (idRol: number): Promise<UserRole | undefined> => {
  const rows = await db.select({ nombre: Roles.nombre }).from(Roles).where(eq(Roles.id, idRol));
  return roleFromName(rows[0]?.nombre);
};

/** Id en la tabla Roles del rol indicado; si la base aún no lo tiene, lo crea. */
export const getOrCreateRoleId = async (role: UserRole): Promise<number> => {
  const roles = await db.select().from(Roles);
  const existing = roles.find((row) => roleFromName(row.nombre) === role);
  if (existing) return existing.id;

  const created = await db.insert(Roles).values({ nombre: role });
  return Number(created[0].insertId);
};

export const canAccessCrm = (role: UserRole | null | undefined): boolean =>
  role === 'administrador' || role === 'vendedor';

export const canAccessScm = (role: UserRole | null | undefined): boolean =>
  role === 'administrador' || role === 'logistica';

export const canAccessErp = (role: UserRole | null | undefined): boolean =>
  role === 'administrador' || role === 'logistica';

export const isUsuarioActivo = (estado: string): boolean => estado.toLowerCase() !== 'inactivo';

export const homeForRole = (role: UserRole | undefined): string =>
  canAccessCrm(role) ? '/crm' : canAccessScm(role) ? '/scm' : '/';

export const getAuthenticatedUser = async (
  sessionToken: string | undefined,
): Promise<AuthenticatedUser | null> => {
  if (!sessionToken || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) return null;

  const rows = await db
    .select({
      id: Usuarios.id,
      rol: Roles.nombre,
      nombre: Usuarios.nombre,
      estado: Usuarios.estado,
    })
    .from(Sesiones)
    .innerJoin(Usuarios, eq(Sesiones.id_usuario, Usuarios.id))
    .innerJoin(Roles, eq(Usuarios.id_rol, Roles.id))
    .where(
      and(
        eq(Sesiones.token_hash, hashSessionToken(sessionToken)),
        gt(Sesiones.fecha_expiracion, new Date()),
      ),
    );

  const user = rows[0];
  const role = user ? roleFromName(user.rol) : undefined;

  return user && role && isUsuarioActivo(user.estado)
    ? { id: user.id, role, nombre: user.nombre }
    : null;
};
