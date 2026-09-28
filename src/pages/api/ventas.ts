import type { APIRoute } from 'astro';
import { db } from '../../db/db';
import { Ventas, DetalleVentas, Clientes, Productos, Usuarios, EtapasCrm, Modelos, Proveedores, PedidosCompra, Notificaciones } from '../../db/schema';
import { eq, sql, inArray, and } from 'drizzle-orm';

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
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Cuerpo de solicitud inválido.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { id_metodo_pago, envio = 0, cupon_descuento, detalles, id_cliente: bodyClientId } = body;

  const clientId = bodyClientId || await getClientId(locals);

  if (!clientId) {
    return new Response(JSON.stringify({ error: 'No se pudo determinar el cliente. Debes iniciar sesión o proporcionar un id_cliente.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!id_metodo_pago || !Array.isArray(detalles) || detalles.length === 0) {
    return new Response(JSON.stringify({ error: 'Faltan datos requeridos (id_metodo_pago, detalles).' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let subtotal_venta = 0;
    const detallesProcesados = [];

    // Validar productos y calcular subtotales
    for (const det of detalles) {
      if (!det.id_producto || !det.cantidad || det.cantidad <= 0) {
        throw new Error('Detalles de producto inválidos. Se requiere id_producto y cantidad > 0.');
      }
      
      const producto = await db
        .select({ id: Productos.id, precio_venta: Productos.precio_venta, stock: Productos.stock })
        .from(Productos)
        .where(eq(Productos.id, det.id_producto));

      if (!producto[0]) {
        throw new Error(`Producto con ID ${det.id_producto} no encontrado.`);
      }

      if (producto[0].stock < det.cantidad) {
        throw new Error(`Stock insuficiente para el producto ID ${det.id_producto}. Stock disponible: ${producto[0].stock}`);
      }

      const precio = Number(producto[0].precio_venta);
      const subtotal_detalle = precio * det.cantidad;

      subtotal_venta += subtotal_detalle;

      detallesProcesados.push({
        id_producto: det.id_producto,
        cantidad: det.cantidad,
        precio_unitario: precio.toString(),
        subtotal: subtotal_detalle.toString(),
      });
    }

    const total = subtotal_venta + Number(envio);

    // Iniciar transacción para insertar Venta, Detalles y descontar stock
    const resultVentaId = await db.transaction(async (tx) => {
      // 1. Insertar Venta
      const resultVenta = await tx.insert(Ventas).values({
        id_cliente: clientId,
        id_usuario: locals.user ? locals.user.id : null,
        id_metodo_pago: id_metodo_pago,
        fecha_venta: new Date(),
        subtotal: subtotal_venta.toString(),
        envio: Number(envio).toString(),
        total: total.toString(),
        cupon_descuento: cupon_descuento || null,
      });

      const ventaId = Number(resultVenta[0].insertId);

      // 2. Insertar DetalleVentas
      const detallesAInsertar = detallesProcesados.map((det) => ({
        id_venta: ventaId,
        id_producto: det.id_producto,
        cantidad: det.cantidad,
        precio_unitario: det.precio_unitario,
        subtotal: det.subtotal,
      }));

      await tx.insert(DetalleVentas).values(detallesAInsertar);

      // 3. Descontar stock
      for (const det of detallesProcesados) {
        await tx.update(Productos)
          .set({ stock: sql`${Productos.stock} - ${det.cantidad}` })
          .where(eq(Productos.id, det.id_producto));
      }

      return ventaId;
    });

    // --- AUTO-EVALUATE PUSH/PULL POST-SALE ---
    try {
      const soldProductIds = detallesProcesados.map(d => d.id_producto);
      
      const productsToCheck = await db.select({
        id: Productos.id,
        nombre: Modelos.nombre,
        stock: Productos.stock,
        stock_minimo: Productos.stock_minimo,
        estrategia: Productos.estrategia_logistica,
        id_proveedor: Productos.id_proveedor,
      })
      .from(Productos)
      .leftJoin(Modelos, eq(Productos.id_modelo, Modelos.id))
      .where(inArray(Productos.id, soldProductIds));

      const now = new Date();

      for (const prod of productsToCheck) {
        if (prod.stock <= (prod.stock_minimo || 0) && (prod.stock_minimo || 0) > 0) {
          
          // Verificar si ya hay un pedido pendiente para no duplicar
          const existingPedido = await db.select().from(PedidosCompra)
            .where(and(eq(PedidosCompra.id_producto, prod.id), eq(PedidosCompra.estado, 'Pendiente')));
          
          if (existingPedido.length > 0) continue;

          const cantidadReponer = Math.max((prod.stock_minimo || 0) * 2 - prod.stock, prod.stock_minimo || 1);
          const estrategia = (prod.estrategia || 'PUSH').toUpperCase();

          if (estrategia === 'PULL') {
            // PULL: Auto-restock order + Notification
            await db.insert(PedidosCompra).values({
              id_producto: prod.id,
              id_proveedor: prod.id_proveedor,
              cantidad: cantidadReponer,
              tipo: 'AUTOMATICO',
              estado: 'Pendiente',
              fecha_creacion: now,
              stock_anterior: prod.stock,
              stock_posterior: null,
            });

            await db.insert(Notificaciones).values({
              tipo: 'pedido_auto',
              titulo: `Pedido automático (PULL) — ${prod.nombre}`,
              mensaje: `El stock bajó al límite (${prod.stock}). Se generó automáticamente un pedido de ${cantidadReponer} uds.`,
              id_producto: prod.id,
              leida: false,
              fecha_creacion: now,
            });
          } else {
            // PUSH: Manual alert Notification only
            const existingNotif = await db.select().from(Notificaciones)
              .where(and(eq(Notificaciones.id_producto, prod.id), eq(Notificaciones.leida, false), eq(Notificaciones.tipo, 'stock_bajo')));
              
            if (existingNotif.length === 0) {
              await db.insert(Notificaciones).values({
                tipo: 'stock_bajo',
                titulo: `⚠️ Alerta PUSH: Stock crítico — ${prod.nombre}`,
                mensaje: `El producto bajó de su mínimo (${prod.stock} uds). Evalúa si es necesario programar un lote de compra (PUSH).`,
                id_producto: prod.id,
                leida: false,
                fecha_creacion: now,
              });
            }
          }
        }
      }
    } catch (e) {
      console.error("Error auto-checking push/pull after sale:", e);
    }
    // ------------------------------------------

    return new Response(JSON.stringify({ success: true, id_venta: resultVentaId }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Error interno al procesar la venta.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
