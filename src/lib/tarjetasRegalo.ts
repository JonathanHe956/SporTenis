import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { Monederos, MovimientosMonedero, TarjetasRegalo } from '../db/schema';
import { MonederoError } from './monedero';

const CODIGO_ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODIGO_NORMALIZADO = /^ST[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{16}$/;

export const normalizarCodigoTarjeta = (codigo: string): string =>
  codigo.toUpperCase().replace(/[\s-]/g, '');

export const hashCodigoTarjeta = (codigo: string): string => {
  const normalizado = normalizarCodigoTarjeta(codigo);
  if (!CODIGO_NORMALIZADO.test(normalizado)) {
    throw new MonederoError('El código de la tarjeta no es válido.');
  }
  return createHash('sha256').update(normalizado).digest('hex');
};

export const generarCodigoTarjeta = (): string => {
  const aleatorios = randomBytes(16);
  const codigo = Array.from(aleatorios, (byte) => CODIGO_ALFABETO[byte & 31]).join('');
  return `ST-${codigo.slice(0, 4)}-${codigo.slice(4, 8)}-${codigo.slice(8, 12)}-${codigo.slice(12)}`;
};

export const canjearTarjetaRegalo = async (
  idCliente: number,
  codigo: string,
): Promise<{ monto: number; saldo: number }> => {
  const codigoHash = hashCodigoTarjeta(codigo);

  return db.transaction(async (tx) => {
    const [tarjeta] = await tx
      .select({
        id: TarjetasRegalo.id,
        monto: TarjetasRegalo.monto,
        canjeada_por: TarjetasRegalo.canjeada_por,
      })
      .from(TarjetasRegalo)
      .where(eq(TarjetasRegalo.codigo_hash, codigoHash))
      .limit(1)
      .for('update');

    if (!tarjeta || tarjeta.canjeada_por !== null) {
      throw new MonederoError('El código no es válido o ya fue canjeado.', 400);
    }

    const [actualizacion] = await tx
      .update(TarjetasRegalo)
      .set({ canjeada_por: idCliente, fecha_canje: new Date() })
      .where(and(eq(TarjetasRegalo.id, tarjeta.id), isNull(TarjetasRegalo.canjeada_por)));

    if (actualizacion.affectedRows !== 1) {
      throw new MonederoError('El código no es válido o ya fue canjeado.', 400);
    }

    await tx
      .insert(Monederos)
      .values({ id_cliente: idCliente, saldo: tarjeta.monto })
      .onDuplicateKeyUpdate({
        set: { saldo: sql`${Monederos.saldo} + ${tarjeta.monto}` },
      });

    const [monedero] = await tx
      .select({ id: Monederos.id, saldo: Monederos.saldo })
      .from(Monederos)
      .where(eq(Monederos.id_cliente, idCliente));

    if (!monedero) throw new Error('No se pudo encontrar el monedero después del canje.');

    await tx.insert(MovimientosMonedero).values({
      id_monedero: monedero.id,
      tipo: 'Canjeo',
      monto: tarjeta.monto,
      fecha: new Date(),
      id_tarjeta_regalo: tarjeta.id,
    });

    return { monto: Number(tarjeta.monto), saldo: Number(monedero.saldo) };
  });
};
