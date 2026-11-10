import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { db } from '../db/db';
import { FacturaImpuestos, Facturas, Pagos } from '../db/schema';
import { esTablaInexistente } from './dbErrores';
import { IVA_POR_DEFECTO, desglosarImpuestos, impuestosVigentes } from './impuestos';
import { cobrarCompra, esMetodoMonedero, reembolsarCompra } from './monedero';

// Los precios de la tienda ya incluyen los impuestos: la factura solo separa del total
// la base y el monto de cada impuesto activo. Esta es la tasa de respaldo.
export const TASA_IVA = IVA_POR_DEFECTO;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const toCents = (value: number): number => Math.round(value * 100);

export const folioFactura = (id_venta: number): string => `FAC-${String(id_venta).padStart(6, '0')}`;

/** Separa un total con IVA incluido en base e impuesto, sin perder centavos. */
export const desglosarIva = (total: number, tasa = TASA_IVA): { subtotal: number; iva: number; total: number } => {
  const totalCents = toCents(total);
  const baseCents = Math.round(totalCents / (1 + tasa));
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
  venta: { id_venta: number; id_metodo_pago: number; total: number; referencia_pago?: string | null },
): Promise<{ id_factura: number; folio: string }> {
  const ahora = new Date();

  // Pagada con el monedero: se cobra aquí; si el saldo no alcanza, la confirmación completa se revierte
  if (await esMetodoMonedero(tx, venta.id_metodo_pago)) {
    await cobrarCompra(tx, { id_venta: venta.id_venta, total: venta.total });
  }

  const importes = desglosarImpuestos(venta.total, await impuestosVigentes(tx));
  const folio = folioFactura(venta.id_venta);

  const [resFactura] = await tx.insert(Facturas).values({
    id_venta: venta.id_venta,
    folio,
    uuid: randomUUID(),
    subtotal: importes.subtotal.toFixed(2),
    // La columna `iva` guarda el total de impuestos; el detalle por impuesto va en FacturaImpuestos
    iva: importes.total_impuestos.toFixed(2),
    total: importes.total.toFixed(2),
    estado: 'Emitida',
    fecha_emision: ahora,
  });
  const id_factura = Number(resFactura.insertId);

  if (importes.impuestos.length > 0) {
    try {
      await tx.insert(FacturaImpuestos).values(importes.impuestos.map((imp) => ({
        id_factura,
        nombre: imp.nombre,
        porcentaje: imp.porcentaje.toFixed(2),
        monto: imp.monto.toFixed(2),
      })));
    } catch (error) {
      // Sin la migración 0012 la factura se emite igual, solo sin el detalle por impuesto
      if (!esTablaInexistente(error)) throw error;
    }
  }

  const estado = estadoConciliacion(venta.total, importes.total);
  await tx.insert(Pagos).values({
    id_venta: venta.id_venta,
    id_factura,
    id_metodo_pago: venta.id_metodo_pago,
    monto: venta.total.toFixed(2),
    estado,
    fecha_pago: ahora,
    fecha_conciliacion: estado === 'Conciliado' ? ahora : null,
    referencia: venta.referencia_pago ?? null,
  });

  return { id_factura, folio };
}

/**
 * Al cancelar una venta confirmada se cancela su factura y el cobro queda como reembolsado;
 * si se pagó con el monedero, el importe regresa al saldo del cliente.
 */
export async function cancelarFacturaYPago(tx: Tx, id_venta: number): Promise<void> {
  await reembolsarCompra(tx, id_venta);
  await tx
    .update(Facturas)
    .set({ estado: 'Cancelada', fecha_cancelacion: new Date() })
    .where(eq(Facturas.id_venta, id_venta));
  await tx.update(Pagos).set({ estado: 'Reembolsado' }).where(eq(Pagos.id_venta, id_venta));
}
