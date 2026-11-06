import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { Monederos, MovimientosMonedero } from '../db/schema';

const MAX_SALDO_CENTAVOS = 9_999_999_999;

export class MonederoError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'MonederoError';
    this.status = status;
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
    })
    .from(MovimientosMonedero)
    .innerJoin(Monederos, eq(MovimientosMonedero.id_monedero, Monederos.id))
    .where(eq(Monederos.id_cliente, idCliente))
    .orderBy(desc(MovimientosMonedero.fecha), desc(MovimientosMonedero.id))
    .limit(10);

export const recargar = async (idCliente: number, monto: number): Promise<void> => {
  const centavos = montoEnCentavos(monto);
  const importe = saldoFormateado(centavos);

  await db.transaction(async (tx) => {
    await tx
      .insert(Monederos)
      .values({ id_cliente: idCliente, saldo: importe })
      .onDuplicateKeyUpdate({
        set: { saldo: sql`${Monederos.saldo} + ${importe}` },
      });

    const [monedero] = await tx
      .select({ id: Monederos.id })
      .from(Monederos)
      .where(eq(Monederos.id_cliente, idCliente));

    if (!monedero) throw new Error('No se pudo encontrar el monedero después de recargar.');

    await tx.insert(MovimientosMonedero).values({
      id_monedero: monedero.id,
      tipo: 'Recarga',
      monto: importe,
    });
  });
};

export const descontar = async (idCliente: number, monto: number): Promise<void> => {
  const centavos = montoEnCentavos(monto);
  const importe = saldoFormateado(centavos);
  await db.transaction(async (tx) => {
    const [result] = await tx
      .update(Monederos)
      .set({ saldo: sql`${Monederos.saldo} - ${importe}` })
      .where(and(
        eq(Monederos.id_cliente, idCliente),
        gte(Monederos.saldo, importe),
      ));

    if (result.affectedRows === 0) {
      throw new MonederoError('Saldo insuficiente.');
    }

    const [monedero] = await tx
      .select({ id: Monederos.id })
      .from(Monederos)
      .where(eq(Monederos.id_cliente, idCliente));

    if (!monedero) throw new Error('No se pudo encontrar el monedero después del descuento.');

    await tx.insert(MovimientosMonedero).values({
      id_monedero: monedero.id,
      tipo: 'Descuento',
      monto: importe,
    });
  });
};

export const eliminarMonedero = async (idCliente: number): Promise<void> => {
  await db.delete(Monederos).where(eq(Monederos.id_cliente, idCliente));
};
