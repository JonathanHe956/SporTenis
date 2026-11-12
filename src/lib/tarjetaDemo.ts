import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { Monederos, MovimientosMonedero, SaldoTarjetaDemo } from '../db/schema';
import { MonederoError } from './monedero';

export const TARJETA_DEMO = {
  numero: '9999000000004000',
  vencimiento: '12/30',
  cvv: '123',
} as const;

const SALDO_INICIAL_CENTAVOS = 4_000_000;
const MAX_MONTO_CENTAVOS = 9_999_999_999;

export const saldoInicialTarjetaDemo = SALDO_INICIAL_CENTAVOS / 100;

export const validarDatosTarjetaDemo = (
  numero: string,
  vencimiento: string,
  cvv: string,
  hoy = new Date(),
): void => {
  const numeroNormalizado = numero.replace(/[\s-]/g, '');
  if (numeroNormalizado !== TARJETA_DEMO.numero || cvv !== TARJETA_DEMO.cvv) {
    throw new MonederoError('Los datos no coinciden con la tarjeta ficticia de prueba.');
  }

  const vencimientoValido = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(vencimiento);
  if (!vencimientoValido || vencimiento !== TARJETA_DEMO.vencimiento) {
    throw new MonederoError('El vencimiento no coincide con la tarjeta ficticia de prueba.');
  }

  const mes = Number(vencimientoValido[1]);
  const anio = 2000 + Number(vencimientoValido[2]);
  if (anio < hoy.getFullYear() || (anio === hoy.getFullYear() && mes < hoy.getMonth() + 1)) {
    throw new MonederoError('La tarjeta ficticia de prueba está vencida.');
  }
};

const montoEnCentavos = (monto: number): number => {
  if (!Number.isFinite(monto) || monto <= 0) {
    throw new MonederoError('El monto debe ser mayor que cero.');
  }
  const centavos = Math.round((monto + Number.EPSILON) * 100);
  if (centavos <= 0 || centavos > MAX_MONTO_CENTAVOS) {
    throw new MonederoError('El monto está fuera del rango permitido.');
  }
  return centavos;
};

const montoFormateado = (centavos: number): string => (centavos / 100).toFixed(2);

export const consultarSaldoTarjetaDemo = async (): Promise<number> => {
  const [tarjeta] = await db
    .select({ saldo: SaldoTarjetaDemo.saldo })
    .from(SaldoTarjetaDemo)
    .where(eq(SaldoTarjetaDemo.id, 1));
  return Number(tarjeta?.saldo ?? 0);
};

export const recargarConTarjetaDemo = async (
  idCliente: number,
  monto: number,
  numero: string,
  vencimiento: string,
  cvv: string,
): Promise<{ monto: number; saldo: number; saldoTarjetaDemo: number }> => {
  validarDatosTarjetaDemo(numero, vencimiento, cvv);
  const centavos = montoEnCentavos(monto);
  const importe = montoFormateado(centavos);

  return db.transaction(async (tx) => {
    const [tarjetaDemo] = await tx
      .select({ saldo: SaldoTarjetaDemo.saldo })
      .from(SaldoTarjetaDemo)
      .where(eq(SaldoTarjetaDemo.id, 1))
      .for('update');

    if (!tarjetaDemo) throw new Error('No está configurado el saldo de la tarjeta ficticia.');
    if (Math.round(Number(tarjetaDemo.saldo) * 100) < centavos) {
      throw new MonederoError('La tarjeta ficticia no tiene fondos suficientes.', 409);
    }

    const [cargo] = await tx
      .update(SaldoTarjetaDemo)
      .set({ saldo: sql`${SaldoTarjetaDemo.saldo} - ${importe}` })
      .where(and(eq(SaldoTarjetaDemo.id, 1), gte(SaldoTarjetaDemo.saldo, importe)));

    if (cargo.affectedRows !== 1) {
      throw new MonederoError('La tarjeta ficticia no tiene fondos suficientes.', 409);
    }

    await tx
      .insert(Monederos)
      .values({ id_cliente: idCliente, saldo: importe })
      .onDuplicateKeyUpdate({
        set: { saldo: sql`${Monederos.saldo} + ${importe}` },
      });

    const [monedero] = await tx
      .select({ id: Monederos.id, saldo: Monederos.saldo })
      .from(Monederos)
      .where(eq(Monederos.id_cliente, idCliente));

    if (!monedero) throw new Error('No se pudo encontrar el monedero después de la recarga.');

    const [saldoActualizado] = await tx
      .select({ saldo: SaldoTarjetaDemo.saldo })
      .from(SaldoTarjetaDemo)
      .where(eq(SaldoTarjetaDemo.id, 1));

    await tx.insert(MovimientosMonedero).values({
      id_monedero: monedero.id,
      tipo: 'RecargaTarjeta',
      monto: importe,
      fecha: new Date(),
    });

    return {
      monto: centavos / 100,
      saldo: Number(monedero.saldo),
      saldoTarjetaDemo: Number(saldoActualizado.saldo),
    };
  });
};
