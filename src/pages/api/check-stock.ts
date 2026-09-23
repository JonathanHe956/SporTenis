import type { APIRoute } from 'astro';
import { db } from '../../db/db';
import { Productos, Modelos, Proveedores, Notificaciones, PedidosCompra } from '../../db/schema';
import { eq, and, lte } from 'drizzle-orm';

export const GET: APIRoute = async () => {
  try {
    // Find all products where stock <= stock_minimo
    const allProducts = await db
      .select({
        id: Productos.id,
        nombre: Modelos.nombre,
        stock: Productos.stock,
        stock_minimo: Productos.stock_minimo,
        estrategia: Productos.estrategia_logistica,
        id_proveedor: Productos.id_proveedor,
        proveedor: Proveedores.nombre,
      })
      .from(Productos)
      .leftJoin(Modelos, eq(Productos.id_modelo, Modelos.id))
      .leftJoin(Proveedores, eq(Productos.id_proveedor, Proveedores.id));

    const lowStockProducts = allProducts.filter(p => p.stock <= (p.stock_minimo || 0) && (p.stock_minimo || 0) > 0);
    
    let pedidosCreados = 0;
    let notificacionesCreadas = 0;

    for (const producto of lowStockProducts) {
      // Check if there's already a pending order for this product
      const existingPedido = await db
        .select()
        .from(PedidosCompra)
        .where(and(
          eq(PedidosCompra.id_producto, producto.id),
          eq(PedidosCompra.estado, 'Pendiente')
        ));

      if (existingPedido.length > 0) {
        continue; // Skip — already has a pending order
      }

      // Check if there's already an unread notification for this product
      const existingNotif = await db
        .select()
        .from(Notificaciones)
        .where(and(
          eq(Notificaciones.id_producto, producto.id),
          eq(Notificaciones.leida, false),
          eq(Notificaciones.tipo, 'stock_bajo')
        ));

      const now = new Date();
      const cantidadReponer = Math.max((producto.stock_minimo || 0) * 2 - producto.stock, producto.stock_minimo || 1);

      if (producto.estrategia === 'PULL') {
        // PULL: Create automatic purchase order
        await db.insert(PedidosCompra).values({
          id_producto: producto.id,
          id_proveedor: producto.id_proveedor,
          cantidad: cantidadReponer,
          tipo: 'AUTOMATICO',
          estado: 'Pendiente',
          fecha_creacion: now,
          stock_anterior: producto.stock,
          stock_posterior: null,
        });
        pedidosCreados++;

        // Also create a notification informing about the auto-order
        await db.insert(Notificaciones).values({
          tipo: 'pedido_auto',
          titulo: `Pedido automático creado — ${producto.nombre}`,
          mensaje: `Se generó automáticamente un pedido de ${cantidadReponer} unidades para "${producto.nombre}" (stock actual: ${producto.stock}, mínimo: ${producto.stock_minimo}). Proveedor: ${producto.proveedor || 'Sin asignar'}.`,
          id_producto: producto.id,
          leida: false,
          fecha_creacion: now,
        });
        notificacionesCreadas++;

      } else {
        // PUSH: Only create notification alert (no auto-order)
        if (existingNotif.length === 0) {
          await db.insert(Notificaciones).values({
            tipo: 'stock_bajo',
            titulo: `⚠️ Stock bajo — ${producto.nombre}`,
            mensaje: `El producto "${producto.nombre}" tiene stock bajo (${producto.stock} uds, mínimo: ${producto.stock_minimo}). Se requiere crear un pedido manualmente.`,
            id_producto: producto.id,
            leida: false,
            fecha_creacion: now,
          });
          notificacionesCreadas++;
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      productosRevisados: allProducts.length,
      productosBajoStock: lowStockProducts.length,
      pedidosCreados,
      notificacionesCreadas,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error: any) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
