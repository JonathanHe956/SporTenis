import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { db } from '../db/db';
import { Facturas, Pagos } from '../db/schema';

// Los precios de la tienda ya incluyen IVA: la factura solo lo desglosa
export const TASA_IVA = 0.16;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const toCents = (value: number): number => Math.round(value * 100);

export const folioFactura = (id_venta: number): string => `FAC-${String(id_venta).padStart(6, '0')}`;

/** Separa un total con IVA incluido en base e impuesto, sin perder centavos. */
export const desglosarIva = (total: number): { subtotal: number; iva: number; total: number } => {
  const totalCents = toCents(total);
  const baseCents = Math.round(totalCents / (1 + TASA_IVA));
  return { subtotal: baseCents / 100, iva: (totalCents - baseCents) / 100, total: totalCents / 100 };
};

/** Un cobro queda conciliado cuando coincide al centavo con el total facturado. */
export const estadoConciliacion = (monto: number, totalFactura: number): 'Conciliado' | 'Con diferencia' =>
  toCents(monto) === toCents(totalFactura) ? 'Conciliado' : 'Con diferencia';

/**
 * Emite la factura de una venta recién confirmada y registra su cobro ya conciliado.
 * Va dentro de la transacción de la confirmación: si falla, la venta no se confirma.
 */
export async function facturarYConciliarVenta(
  tx: Tx,
  venta: { id_venta: number; id_metodo_pago: number; total: number },
): Promise<{ id_factura: number; folio: string }> {
  const ahora = new Date();
  const importes = desglosarIva(venta.total);
  const folio = folioFactura(venta.id_venta);

  const [resFactura] = await tx.insert(Facturas).values({
    id_venta: venta.id_venta,
    folio,
    uuid: randomUUID(),
    subtotal: importes.subtotal.toFixed(2),
    iva: importes.iva.toFixed(2),
    total: importes.total.toFixed(2),
    estado: 'Emitida',
    fecha_emision: ahora,
  });
  const id_factura = Number(resFactura.insertId);

  const estado = estadoConciliacion(venta.total, importes.total);
  await tx.insert(Pagos).values({
    id_venta: venta.id_venta,
    id_factura,
    id_metodo_pago: venta.id_metodo_pago,
    monto: venta.total.toFixed(2),
    estado,
    fecha_pago: ahora,
    fecha_conciliacion: estado === 'Conciliado' ? ahora : null,
  });

  return { id_factura, folio };
}

/** Al cancelar una venta confirmada se cancela su factura y el cobro queda como reembolsado. */
export async function cancelarFacturaYPago(tx: Tx, id_venta: number): Promise<void> {
  await tx
    .update(Facturas)
    .set({ estado: 'Cancelada', fecha_cancelacion: new Date() })
    .where(eq(Facturas.id_venta, id_venta));
  await tx.update(Pagos).set({ estado: 'Reembolsado' }).where(eq(Pagos.id_venta, id_venta));
}
