import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { Clientes, Monederos, MovimientosMonedero, TarjetasRegalo } from '../db/schema';
import { MonederoError } from './monedero';

/** Todas las tarjetas que se generan desde el panel valen lo mismo. */
export const MONTO_TARJETA_REGALO = 2000;
export const MAX_TARJETAS_POR_LOTE = 50;

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

// ---- Panel (administrador): ver los códigos sin canjear y generar lotes nuevos ----

/** Cantidad de tarjetas a generar; llega del formulario como texto. */
export const validarCantidadTarjetas = (valor: unknown): number => {
  const cantidad = Number(valor);
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_TARJETAS_POR_LOTE) {
    throw new MonederoError(`Elige entre 1 y ${MAX_TARJETAS_POR_LOTE} tarjetas.`);
  }
  return cantidad;
};

/** Nombre del lote con la fecha y hora en que se generó, p. ej. L-20261112-085130. */
export const nombreLote = (fecha: Date): string => {
  const dos = (n: number) => String(n).padStart(2, '0');
  return `L-${fecha.getFullYear()}${dos(fecha.getMonth() + 1)}${dos(fecha.getDate())}`
    + `-${dos(fecha.getHours())}${dos(fecha.getMinutes())}${dos(fecha.getSeconds())}`;
};

/** Genera `cantidad` tarjetas de $2,000 con códigos aleatorios, todas en el mismo lote. */
export const generarTarjetasRegalo = async (
  cantidad: number,
  idUsuario: number,
): Promise<{ lote: string; codigos: string[] }> => {
  const total = validarCantidadTarjetas(cantidad);
  const ahora = new Date();
  const lote = nombreLote(ahora);

  const codigos = new Set<string>();
  while (codigos.size < total) codigos.add(generarCodigoTarjeta());

  await db.insert(TarjetasRegalo).values(
    [...codigos].map((codigo) => ({
      codigo_hash: hashCodigoTarjeta(codigo),
      codigo,
      monto: MONTO_TARJETA_REGALO.toFixed(2),
      lote,
      fecha_creacion: ahora,
      generada_por: idUsuario,
    })),
  );

  return { lote, codigos: [...codigos] };
};

export type EstadoTarjeta = 'Activa' | 'Canjeada';

export interface TarjetaRegalo {
  id: number;
  codigo: string | null;
  monto: number;
  lote: string;
  fechaCreacion: Date;
  estado: EstadoTarjeta;
  /** Cliente que la canjeó y cuándo; null mientras siga activa */
  canjeadaPor: string | null;
  fechaCanje: Date | null;
}

/** Todas las tarjetas con su estado, de la más nueva a la más vieja. */
export const listarTarjetasRegalo = async (): Promise<TarjetaRegalo[]> => {
  const rows = await db
    .select({
      id: TarjetasRegalo.id,
      codigo: TarjetasRegalo.codigo,
      monto: TarjetasRegalo.monto,
      lote: TarjetasRegalo.lote,
      fechaCreacion: TarjetasRegalo.fecha_creacion,
      idCliente: TarjetasRegalo.canjeada_por,
      cliente: Clientes.nombre,
      fechaCanje: TarjetasRegalo.fecha_canje,
    })
    .from(TarjetasRegalo)
    .leftJoin(Clientes, eq(Clientes.id, TarjetasRegalo.canjeada_por))
    .orderBy(desc(TarjetasRegalo.id));

  return rows.map(({ idCliente, cliente, ...r }) => ({
    ...r,
    monto: Number(r.monto),
    estado: idCliente === null ? 'Activa' : 'Canjeada',
    canjeadaPor: idCliente === null ? null : (cliente ?? `Cliente #${idCliente}`),
  }));
};
