import { db } from '../db/db';
import { Productos, Modelos, Proveedores, Notificaciones, PedidosCompra, MovimientosInventario, Configuraciones } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

export interface ResultadoLogistica {
  ok: boolean;
  productosRevisados: number;
  pullRepuestos: number;
  pushAlertas: number;
  detalles: Array<{
    id_producto: number;
    nombre: string;
    estrategia: string;
    stockAnterior: number;
    stockPosterior: number;
    cantidadRepuesta?: number;
    accion: 'REPOSICION_PULL' | 'ALERTA_PUSH' | 'SIN_CAMBIO';
  }>;
}

/**
 * Revisa el inventario y ejecuta:
 * - PULL: Reabastecimiento automático del producto, completando el pedido de compra,
 *         aumentando el stock, registrando el movimiento de inventario y notificando.
 * - PUSH: Genera alerta de notificación de stock bajo para que el encargado genere
 *         un pedido de compra manual en /scm/pedidos.
 */
export async function procesarLogisticaStock(options?: {
  id_producto?: number;
  id_usuario?: number;
}): Promise<ResultadoLogistica> {
  const now = new Date();
  const detalles: ResultadoLogistica['detalles'] = [];
  let pullRepuestos = 0;
  let pushAlertas = 0;

  try {
    // 1. Obtener cantidad de reorden global si está configurada
    let reordenConfig = 0;
    try {
      const configRows = await db
        .select()
        .from(Configuraciones)
        .where(eq(Configuraciones.clave, 'STOCK_REORDEN_CANTIDAD'));
      if (configRows.length > 0 && configRows[0].valor) {
        reordenConfig = parseInt(configRows[0].valor, 10) || 0;
      }
    } catch {
      // Configuraciones puede no tener la clave aún
    }

    // 2. Consultar productos a revisar
    const query = db
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

    let productos = await query;

    if (options?.id_producto) {
      productos = productos.filter(p => p.id === options.id_producto);
    }

    // Filtrar los que tienen stock bajo (stock <= stock_minimo y stock_minimo > 0)
    const productosBajoStock = productos.filter(
      p => p.stock <= (p.stock_minimo || 0) && (p.stock_minimo || 0) > 0
    );

    for (const prod of productosBajoStock) {
      const stockActual = Number(prod.stock || 0);
      const stockMinimo = Number(prod.stock_minimo || 0);
      const estrategia = (prod.estrategia || 'PUSH').toUpperCase();
      const nombreProd = prod.nombre || `Producto #${prod.id}`;
      const idProveedor = prod.id_proveedor && prod.id_proveedor > 0 ? prod.id_proveedor : null;

      // Cantidad a reponer: usa la configuración global o la fórmula óptima (el doble del mínimo menos lo que queda)
      const cantidadReponer = reordenConfig > 0 
        ? Math.max(reordenConfig, stockMinimo)
        : Math.max(stockMinimo * 2 - stockActual, stockMinimo, 5);

      if (estrategia === 'PULL') {
        // === ESTRATEGIA PULL: REABASTECIMIENTO AUTOMÁTICO INMEDIATO ===
        const stockAnterior = stockActual;
        const stockPosterior = stockAnterior + cantidadReponer;

        // 1. Actualizar el stock del producto
        await db
          .update(Productos)
          .set({ stock: stockPosterior })
          .where(eq(Productos.id, prod.id));

        // 2. Registrar el pedido de compra como COMPLETADO
        await db.insert(PedidosCompra).values({
          id_producto: prod.id,
          id_proveedor: idProveedor,
          cantidad: cantidadReponer,
          tipo: 'AUTOMATICO',
          estado: 'Completado',
          fecha_creacion: now,
          fecha_completado: now,
          stock_anterior: stockAnterior,
          stock_posterior: stockPosterior,
        });

        // Si existía algún pedido PULL pendiente anterior para este producto, completarlo para evitar inconsistencias
        try {
          await db
            .update(PedidosCompra)
            .set({ estado: 'Completado', fecha_completado: now, stock_posterior: stockPosterior })
            .where(
              and(
                eq(PedidosCompra.id_producto, prod.id),
                eq(PedidosCompra.tipo, 'AUTOMATICO'),
                eq(PedidosCompra.estado, 'Pendiente')
              )
            );
        } catch {
          // Ignorar si falla
        }

        // 3. Registrar movimiento de inventario (Entrada)
        try {
          await db.insert(MovimientosInventario).values({
            id_producto: prod.id,
            tipo: 'Entrada',
            cantidad: cantidadReponer,
            motivo: 'Reabastecimiento automático PULL',
            fecha: now,
            id_usuario: options?.id_usuario || null,
          });
        } catch (e) {
          console.error('Error registrando movimiento de inventario PULL:', e);
        }

        // 4. Generar notificación de reabastecimiento completado
        await db.insert(Notificaciones).values({
          tipo: 'pedido_auto',
          titulo: `✅ Reabastecimiento PULL: ${nombreProd}`,
          mensaje: `Se reabastecieron automáticamente +${cantidadReponer} unidades para "${nombreProd}" (Stock: ${stockAnterior} ➔ ${stockPosterior}, mín: ${stockMinimo}).`,
          id_producto: prod.id,
          leida: false,
          fecha_creacion: now,
        });

        pullRepuestos++;
        detalles.push({
          id_producto: prod.id,
          nombre: nombreProd,
          estrategia: 'PULL',
          stockAnterior,
          stockPosterior,
          cantidadRepuesta: cantidadReponer,
          accion: 'REPOSICION_PULL',
        });

      } else {
        // === ESTRATEGIA PUSH: ALERTA MANUAL PARA COMPRAS ===
        // Verificar si ya existe una notificación no leída para evitar spam
        const existingNotif = await db
          .select()
          .from(Notificaciones)
          .where(
            and(
              eq(Notificaciones.id_producto, prod.id),
              eq(Notificaciones.leida, false),
              eq(Notificaciones.tipo, 'stock_bajo')
            )
          );

        if (existingNotif.length === 0) {
          await db.insert(Notificaciones).values({
            tipo: 'stock_bajo',
            titulo: `⚠️ Stock bajo (PUSH): ${nombreProd}`,
            mensaje: `El producto "${nombreProd}" tiene stock crítico (${stockActual} uds, mín: ${stockMinimo}). Estrategia PUSH: Requiere crear un pedido manual.`,
            id_producto: prod.id,
            leida: false,
            fecha_creacion: now,
          });
          pushAlertas++;
        }

        detalles.push({
          id_producto: prod.id,
          nombre: nombreProd,
          estrategia: 'PUSH',
          stockAnterior: stockActual,
          stockPosterior: stockActual,
          accion: 'ALERTA_PUSH',
        });
      }
    }

    return {
      ok: true,
      productosRevisados: productos.length,
      pullRepuestos,
      pushAlertas,
      detalles,
    };
  } catch (error: any) {
    console.error('Error en procesarLogisticaStock:', error);
    return {
      ok: false,
      productosRevisados: 0,
      pullRepuestos: 0,
      pushAlertas: 0,
      detalles: [],
    };
  }
}
