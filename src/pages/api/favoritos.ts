import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/db';
import { Clientes, EtapasCrm, Favoritos, Productos, Usuarios } from '../../db/schema';

const getClientId = async (locals: App.Locals) => {
  if (!locals.user) return null;

  const client = await db
    .select({ id: Clientes.id })
    .from(Clientes)
    .where(eq(Clientes.id_usuario, locals.user.id));

  if (client[0]) return client[0].id;

  const user = await db
    .select({ id: Usuarios.id, nombre: Usuarios.nombre, correo: Usuarios.correo })
    .from(Usuarios)
    .where(eq(Usuarios.id, locals.user.id));
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

export const POST: APIRoute = async ({ request, locals }) => {
  const clientId = await getClientId(locals);
  if (!clientId) {
    return new Response(JSON.stringify({ error: 'Debes iniciar sesión para usar favoritos.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let productId: number;
  try {
    const body = await request.json();
    productId = Number(body.productId);
  } catch {
    return new Response(JSON.stringify({ error: 'Solicitud inválida.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!Number.isInteger(productId) || productId <= 0) {
    return new Response(JSON.stringify({ error: 'Producto inválido.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const product = await db
    .select({ id: Productos.id })
    .from(Productos)
    .where(eq(Productos.id, productId));

  if (!product[0]) {
    return new Response(JSON.stringify({ error: 'Producto no encontrado.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const existing = await db
    .select({ id: Favoritos.id })
    .from(Favoritos)
    .where(and(eq(Favoritos.id_cliente, clientId), eq(Favoritos.id_producto, productId)));

  if (existing[0]) {
    await db.delete(Favoritos).where(eq(Favoritos.id, existing[0].id));
    return new Response(JSON.stringify({ favorite: false }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await db.insert(Favoritos).values({ id_cliente: clientId, id_producto: productId });
  return new Response(JSON.stringify({ favorite: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
