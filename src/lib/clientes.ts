import { eq } from 'drizzle-orm';
import { db } from '../db/db';
import { Clientes, EtapasCrm, Usuarios } from '../db/schema';

export const findClientId = async (userId: number): Promise<number | null> => {
  const client = await db
    .select({ id: Clientes.id })
    .from(Clientes)
    .where(eq(Clientes.id_usuario, userId));

  return client[0]?.id ?? null;
};

// Devuelve el cliente ligado al usuario; si aún no existe (p. ej. personal interno) lo crea.
export const getOrCreateClientId = async (userId: number): Promise<number | null> => {
  const existing = await findClientId(userId);
  if (existing) return existing;

  const user = await db
    .select({ id: Usuarios.id, nombre: Usuarios.nombre, correo: Usuarios.correo })
    .from(Usuarios)
    .where(eq(Usuarios.id, userId));
  if (!user[0]) return null;

  const etapa = await db.select({ id: EtapasCrm.id }).from(EtapasCrm);
  const createdClient = await db.insert(Clientes).values({
    id_usuario: user[0].id,
    id_etapa_crm: etapa[0]?.id ?? null,
    nombre: user[0].nombre,
    correo: user[0].correo,
    estado: 'Activo',
    fecha_registro: new Date(),
  });

  return Number(createdClient[0].insertId);
};
