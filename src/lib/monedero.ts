import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { MetodosPago, Monederos, MovimientosMonedero, Ventas } from '../db/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Pick<typeof db, 'select'>;

/** Nombre del método de pago con el que la tienda cobra del monedero. */
export const METODO_MONEDERO = 'Monedero';

const MAX_SALDO_CENTAVOS = 9_999_999_999;

export class MonederoError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'MonederoError';
    this.status = status;
  }
}

const pesos = (centavos: number): string =>
  `$${(centavos / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** El saldo no alcanza para pagar la compra: la venta completa se revierte. */
export class SaldoInsuficienteError extends MonederoError {
  saldo: number;
  total: number;
  faltante: number;

  constructor(saldoCentavos: number, totalCentavos: number) {
    const faltanteCentavos = totalCentavos - saldoCentavos;
    super(
      `Saldo insuficiente en tu monedero: tienes ${pesos(saldoCentavos)} y la compra es de ${pesos(totalCentavos)}. `
        + `Te faltan ${pesos(faltanteCentavos)}; recarga tu monedero para completar la compra.`,
      409,
    );
    this.name = 'SaldoInsuficienteError';
    this.saldo = saldoCentavos / 100;
    this.total = totalCentavos / 100;
    this.faltante = faltanteCentavos / 100;
  }
}

const montoEnCentavos = (monto: number): number => {
  if (!Number.isFinite(monto) || monto <= 0) {
    throw new MonederoError('El monto debe ser mayor que cero.');
  }

  const centavos = Math.round((monto + Number.EPSILON) * 100);
  if (centavos <= 0 || centavos > MAX_SALDO_CENTAVOS) {
    throw new MonederoError('El monto está fuera del rango permitido.');
  }

  return centavos;
};

const saldoFormateado = (centavos: number): string => (centavos / 100).toFixed(2);

export const consultarSaldo = async (idCliente: number): Promise<number> => {
  const rows = await db
    .select({ saldo: Monederos.saldo })
    .from(Monederos)
    .where(eq(Monederos.id_cliente, idCliente));

  return Number(rows[0]?.saldo ?? 0);
};

export const consultarMovimientos = async (idCliente: number) =>
  db
    .select({
      id: MovimientosMonedero.id,
      tipo: MovimientosMonedero.tipo,
      monto: MovimientosMonedero.monto,
      fecha: MovimientosMonedero.fecha,
      id_venta: MovimientosMonedero.id_venta,
    })
    .from(MovimientosMonedero)
    .innerJoin(Monederos, eq(MovimientosMonedero.id_monedero, Monederos.id))
    .where(eq(Monederos.id_cliente, idCliente))
    .orderBy(desc(MovimientosMonedero.fecha), desc(MovimientosMonedero.id))
    .limit(10);

export async function esMetodoMonedero(executor: Executor, id_metodo_pago: number): Promise<boolean> {
  const [metodo] = await executor.select({ nombre: MetodosPago.nombre }).from(MetodosPago).where(eq(MetodosPago.id, id_metodo_pago));
  return metodo?.nombre === METODO_MONEDERO;
}

/**
 * Cobra una compra del monedero del cliente de la venta. Va dentro de la transacción que confirma
 * la venta: si el saldo no alcanza se lanza SaldoInsuficienteError y no queda nada registrado
 * (ni la venta, ni el stock, ni la factura). El descuento condicionado a `saldo >= total` evita
 * que dos compras simultáneas dejen el saldo en negativo.
 */
export async function cobrarCompra(tx: Tx, compra: { id_venta: number; total: number }): Promise<void> {
  const centavos = montoEnCentavos(compra.total);
  const importe = saldoFormateado(centavos);

  const [venta] = await tx.select({ id_cliente: Ventas.id_cliente }).from(Ventas).where(eq(Ventas.id, compra.id_venta));
  if (!venta) throw new MonederoError('No se encontró la compra a cobrar.', 404);

  const [result] = await tx
    .update(Monederos)
    .set({ saldo: sql`${Monederos.saldo} - ${importe}` })
    .where(and(eq(Monederos.id_cliente, venta.id_cliente), gte(Monederos.saldo, importe)));

  if (result.affectedRows === 0) {
    const [monedero] = await tx.select({ saldo: Monederos.saldo }).from(Monederos).where(eq(Monederos.id_cliente, venta.id_cliente));
    throw new SaldoInsuficienteError(Math.round(Number(monedero?.saldo ?? 0) * 100), centavos);
  }

  const [monedero] = await tx.select({ id: Monederos.id }).from(Monederos).where(eq(Monederos.id_cliente, venta.id_cliente));
  if (!monedero) throw new Error('No se pudo encontrar el monedero después del cobro.');

  await tx.insert(MovimientosMonedero).values({
    id_monedero: monedero.id,
    tipo: 'Descuento',
    monto: importe,
    fecha: new Date(),
    id_venta: compra.id_venta,
  });
}

/**
 * Devuelve al monedero lo que se cobró por una compra que se cancela. Si la compra no se pagó
 * con el monedero, o ya se reembolsó, no hace nada.
 */
export async function reembolsarCompra(tx: Tx, id_venta: number): Promise<void> {
  const movimientos = await tx
    .select({ id_monedero: MovimientosMonedero.id_monedero, tipo: MovimientosMonedero.tipo, monto: MovimientosMonedero.monto })
    .from(MovimientosMonedero)
    .where(eq(MovimientosMonedero.id_venta, id_venta));

  const cobro = movimientos.find((m) => m.tipo === 'Descuento');
  if (!cobro || movimientos.some((m) => m.tipo === 'Reembolso')) return;

  await tx
    .update(Monederos)
    .set({ saldo: sql`${Monederos.saldo} + ${cobro.monto}` })
    .where(eq(Monederos.id, cobro.id_monedero));

  await tx.insert(MovimientosMonedero).values({
    id_monedero: cobro.id_monedero,
    tipo: 'Reembolso',
    monto: cobro.monto,
    fecha: new Date(),
    id_venta,
  });
}

export const eliminarMonedero = async (idCliente: number): Promise<void> => {
  await db.delete(Monederos).where(eq(Monederos.id_cliente, idCliente));
};
