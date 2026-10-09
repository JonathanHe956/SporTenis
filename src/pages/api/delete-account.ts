import type { APIRoute } from 'astro';
import { db } from '../../db/db';
import {
  Usuarios,
  Clientes,
  Direcciones,
  PreferenciasCliente,
  Favoritos,
  Carritos,
  DetalleCarritos,
} from '../../db/schema';
import { eq } from 'drizzle-orm';
import { SESSION_COOKIE } from '../../lib/session';

export const POST: APIRoute = async ({ cookies, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Solo los clientes pueden eliminar su propia cuenta;
  // el personal interno debe ser desactivado por un administrador.
  if (locals.user.role !== 'cliente') {
    return new Response(
      JSON.stringify({ error: 'El personal interno no puede eliminar su cuenta desde aquí.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const userId = locals.user.id;

  try {
    // Buscar el cliente asociado al usuario
    const clienteResult = await db
      .select()
      .from(Clientes)
      .where(eq(Clientes.id_usuario, userId));

    if (clienteResult.length > 0) {
      const clienteId = clienteResult[0].id;

      // Borrar datos relacionados al cliente (en orden por dependencias FK)
      // 1. Detalle de carritos (depende de Carritos)
      const carritosResult = await db
        .select()
        .from(Carritos)
        .where(eq(Carritos.id_cliente, clienteId));

      for (const carrito of carritosResult) {
        await db
          .delete(DetalleCarritos)
          .where(eq(DetalleCarritos.id_carrito, carrito.id));
      }

      // 2. Carritos
      await db.delete(Carritos).where(eq(Carritos.id_cliente, clienteId));

      // 3. Favoritos
      await db.delete(Favoritos).where(eq(Favoritos.id_cliente, clienteId));

      // 4. Preferencias del cliente
      await db
        .delete(PreferenciasCliente)
        .where(eq(PreferenciasCliente.id_cliente, clienteId));

      // 5. Direcciones
      await db
        .delete(Direcciones)
        .where(eq(Direcciones.id_cliente, clienteId));

      // 6. Cliente
      await db.delete(Clientes).where(eq(Clientes.id, clienteId));
    }

    // 7. Usuario
    await db.delete(Usuarios).where(eq(Usuarios.id, userId));

    // Limpiar cookie de sesión
    cookies.delete(SESSION_COOKIE, { path: '/' });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error al eliminar cuenta:', error);
    return new Response(
      JSON.stringify({ error: 'Error al eliminar la cuenta' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
