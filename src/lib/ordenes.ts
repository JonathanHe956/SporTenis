// Cambio de estado de una orden (Procesando → Confirmada → Entregada, o Cancelada). Lo usan
// /erp/ordenes y la aprobación de cancelaciones desde los tickets de soporte.
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { DetalleVentas, MetodosPago, MovimientosInventario, Pagos, Productos, Ventas } from '../db/schema';
import { avisarPedido } from './avisosCorreo';
import { cancelarFacturaYPago, facturarYConciliarVenta } from './facturacion';
import { MercadoPagoError, reembolsarVentaMercadoPago } from './mercadoPago';
import { describirReembolso, type Reembolso } from './reembolsos';
import { procesarLogisticaStock } from './stockLogistics';
import { registrarHistorialOrden } from './ventas';

export const ESTADOS_ORDEN = ['Procesando', 'Confirmada', 'Entregada', 'Cancelada'] as const;
export type EstadoOrden = (typeof ESTADOS_ORDEN)[number];

export const esEstadoOrden = (value: string): value is EstadoOrden =>
  ESTADOS_ORDEN.includes(value as EstadoOrden);

/** Error con un mensaje que se puede mostrar al usuario tal cual. */
export class OrdenError extends Error {}

/** Solo se avanza un paso a la vez; se puede cancelar mientras no se haya entregado. */
export const transicionPermitida = (actual: EstadoOrden, siguiente: EstadoOrden): boolean =>
  (actual === 'Procesando' && siguiente === 'Confirmada')
  || (actual === 'Confirmada' && siguiente === 'Entregada')
  || ((actual === 'Procesando' || actual === 'Confirmada') && siguiente === 'Cancelada');

export const esCancelable = (estado: string): boolean =>
  estado === 'Procesando' || estado === 'Confirmada';

/**
 * Cambia el estado de la orden en una transacción. Confirmar descuenta el stock, factura y concilia
 * el cobro. Cancelar una orden confirmada (ya cobrada) regresa el stock, cancela la factura y
 * reembolsa: al monedero si se pagó con él, en Mercado Pago con su API, o a la tarjeta (simulada).
 * Al terminar se avisa al cliente por correo. Devuelve a dónde regresó el dinero al cancelar.
 * Lanza OrdenError o MonederoError con mensajes para el usuario.
 */
export async function cambiarEstadoOrden(
  idOrden: number,
  siguiente: EstadoOrden,
  idUsuario: number | null,
): Promise<{ reembolso: Reembolso | null }> {
  if (!Number.isSafeInteger(idOrden) || idOrden <= 0 || !esEstadoOrden(siguiente)) {
    throw new OrdenError('La orden o el estado seleccionado no son válidos.');
  }

  const { productos, reembolso } = await db.transaction(async (tx): Promise<{ productos: number[]; reembolso: Reembolso | null }> => {
    // Se bloquea la orden para no confirmarla mientras alguien la modifica
    const [orden] = await tx
      .select({ estado: Ventas.estado, total: Ventas.total, id_metodo_pago: Ventas.id_metodo_pago })
      .from(Ventas)
      .where(eq(Ventas.id, idOrden))
      .for('update');

    if (!orden) throw new OrdenError('No se encontró la orden solicitada.');
    if (!esEstadoOrden(orden.estado)) throw new OrdenError('La orden tiene un estado no reconocido.');

    const actual = orden.estado;
    if (!transicionPermitida(actual, siguiente)) {
      throw new OrdenError('La transición de estado solicitada no está permitida.');
    }
    const confirma = siguiente === 'Confirmada';
    const entrega = siguiente === 'Entregada';

    const [updated] = await tx
      .update(Ventas)
      .set({ estado: siguiente, fecha_entrega: entrega ? new Date() : null })
      .where(and(eq(Ventas.id, idOrden), eq(Ventas.estado, actual)));

    if (updated.affectedRows !== 1) {
      throw new OrdenError('La orden cambió mientras se procesaba. Actualiza la página e inténtalo de nuevo.');
    }

    await registrarHistorialOrden(tx, {
      id_venta: idOrden,
      id_usuario: idUsuario,
      estado_anterior: actual,
      estado_nuevo: siguiente,
    });

    // Una orden en Procesando todavía no tocó el inventario ni se cobró: cancelarla no revierte nada
    if (siguiente === 'Cancelada' && actual === 'Procesando') {
      return { productos: [], reembolso: describirReembolso({ metodo: null, referencia: null, monto: 0, cobrado: false }) };
    }
    if (!confirma && siguiente !== 'Cancelada') return { productos: [], reembolso: null };

    const lineas = await tx
      .select({ id_producto: DetalleVentas.id_producto, cantidad: DetalleVentas.cantidad })
      .from(DetalleVentas)
      .where(eq(DetalleVentas.id_venta, idOrden));

    if (confirma && lineas.length === 0) {
      throw new OrdenError('No se puede confirmar una orden sin productos.');
    }

    for (const linea of lineas) {
      const [stockChange] = await tx
        .update(Productos)
        .set({
          stock: confirma
            ? sql`${Productos.stock} - ${linea.cantidad}`
            : sql`${Productos.stock} + ${linea.cantidad}`,
        })
        .where(confirma
          ? and(eq(Productos.id, linea.id_producto), gte(Productos.stock, linea.cantidad))
          : eq(Productos.id, linea.id_producto));

      if (stockChange.affectedRows !== 1) {
        throw new OrdenError(confirma
          ? `Stock insuficiente para uno de los productos de la orden #${idOrden}. Modifica la orden o repón el inventario antes de confirmarla.`
          : `No se pudo devolver al inventario un producto de la orden #${idOrden}.`);
      }
    }

    if (lineas.length > 0) {
      await tx.insert(MovimientosInventario).values(
        lineas.map((linea) => ({
          id_producto: linea.id_producto,
          tipo: confirma ? 'Salida' : 'Entrada',
          cantidad: linea.cantidad,
          motivo: confirma ? `Venta #${idOrden}` : `Cancelación de venta #${idOrden}`,
          fecha: new Date(),
          id_usuario: idUsuario,
          id_venta: idOrden,
        })),
      );
    }

    // Al confirmar se factura y se concilia el cobro; al cancelar se revierten
    if (confirma) {
      await facturarYConciliarVenta(tx, {
        id_venta: idOrden,
        id_metodo_pago: orden.id_metodo_pago,
        total: Number(orden.total),
      });
      return { productos: lineas.map((linea) => linea.id_producto), reembolso: null };
    }

    // Cancelación de una orden cobrada: con qué se pagó, para saber a dónde regresa el dinero
    const [pago] = await tx
      .select({ monto: Pagos.monto, referencia: Pagos.referencia, metodo: MetodosPago.nombre })
      .from(Pagos)
      .leftJoin(MetodosPago, eq(Pagos.id_metodo_pago, MetodosPago.id))
      .where(eq(Pagos.id_venta, idOrden))
      .limit(1);

    // Factura cancelada, pago "Reembolsado" y, si se pagó con el monedero, el saldo de vuelta
    await cancelarFacturaYPago(tx, idOrden);

    // Mercado Pago: el dinero se devuelve con su API, al final y dentro de la transacción; si no lo
    // acepta, la cancelación completa se revierte para no dejar un pedido cancelado sin reembolso
    try {
      await reembolsarVentaMercadoPago(tx, idOrden);
    } catch (error) {
      if (error instanceof MercadoPagoError) throw new OrdenError(error.message);
      throw error;
    }

    return {
      productos: [],
      reembolso: describirReembolso({
        metodo: pago?.metodo ?? null,
        referencia: pago?.referencia ?? null,
        monto: Number(pago?.monto ?? orden.total),
        cobrado: Boolean(pago),
      }),
    };
  });

  // Reposición PULL automática o alerta PUSH para los productos que salieron del inventario
  for (const id_producto of new Set(productos)) {
    await procesarLogisticaStock({ id_producto, id_usuario: idUsuario ?? undefined });
  }

  avisarPedido(idOrden, siguiente === 'Confirmada' ? 'confirmado' : siguiente === 'Entregada' ? 'entregado' : 'cancelado', reembolso ?? undefined);
  return { reembolso };
}
