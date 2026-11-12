import { desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { Clientes, Monederos, MovimientosMonedero } from '../db/schema';
import { MonederoError } from './monedero';

// Monedero desde la administración: saldos de todos los clientes, ajustes manuales y reporte de uso.

export type TipoAjuste = 'abono' | 'cargo';

export interface AjusteValidado {
  idCliente: number;
  tipo: TipoAjuste;
  /** Monto en centavos, siempre positivo */
  centavos: number;
  motivo: string;
}

const MAX_AJUSTE_CENTAVOS = 10_000_000; // $100,000.00 por ajuste

/** Movimientos que meten dinero al monedero (el cliente recarga o canjea). */
export const TIPOS_RECARGA = ['Recarga', 'RecargaTarjeta', 'Canjeo'] as const;

const pesos = (centavos: number): string => (centavos / 100).toFixed(2);

/** Valida lo que manda el formulario de ajuste antes de tocar la base. */
export function validarAjuste(body: Record<string, unknown>): AjusteValidado {
  const idCliente = Number(body.id_cliente);
  if (!Number.isInteger(idCliente) || idCliente <= 0) throw new MonederoError('Elige un cliente válido.');

  const tipo = body.tipo;
  if (tipo !== 'abono' && tipo !== 'cargo') throw new MonederoError('El ajuste debe ser un abono o un cargo.');

  const monto = Number(body.monto);
  const centavos = Math.round((monto + Number.EPSILON) * 100);
  if (body.monto === '' || body.monto === null || !Number.isFinite(monto) || centavos <= 0) {
    throw new MonederoError('El monto debe ser mayor que cero.');
  }
  if (centavos > MAX_AJUSTE_CENTAVOS) throw new MonederoError('Un ajuste no puede pasar de $100,000.00.');

  const motivo = String(body.motivo ?? '').trim();
  if (motivo.length < 5) throw new MonederoError('Escribe el motivo del ajuste (mínimo 5 caracteres).');
  if (motivo.length > 255) throw new MonederoError('El motivo no puede pasar de 255 caracteres.');

  return { idCliente, tipo, centavos, motivo };
}

/** Saldo que queda después del ajuste; un cargo nunca deja el monedero en negativo. */
export function saldoTrasAjuste(saldoCentavos: number, ajuste: Pick<AjusteValidado, 'tipo' | 'centavos'>): number {
  if (ajuste.tipo === 'abono') return saldoCentavos + ajuste.centavos;
  if (ajuste.centavos > saldoCentavos) {
    throw new MonederoError(`El cargo de $${pesos(ajuste.centavos)} es mayor que el saldo actual ($${pesos(saldoCentavos)}).`, 409);
  }
  return saldoCentavos - ajuste.centavos;
}

/**
 * Aplica el ajuste en una transacción: bloquea el monedero (o lo crea en un abono), actualiza
 * el saldo y registra el movimiento con su motivo y el administrador que lo hizo.
 */
export async function ajustarSaldo(ajuste: AjusteValidado, idUsuario: number): Promise<{ saldo: number }> {
  return db.transaction(async (tx) => {
    const [cliente] = await tx.select({ id: Clientes.id }).from(Clientes).where(eq(Clientes.id, ajuste.idCliente));
    if (!cliente) throw new MonederoError('Cliente no encontrado.', 404);

    let [monedero] = await tx
      .select({ id: Monederos.id, saldo: Monederos.saldo })
      .from(Monederos)
      .where(eq(Monederos.id_cliente, ajuste.idCliente))
      .for('update');

    if (!monedero) {
      if (ajuste.tipo === 'cargo') throw new MonederoError('El cliente no tiene saldo en su monedero.', 409);
      const [res] = await tx.insert(Monederos).values({ id_cliente: ajuste.idCliente, saldo: '0.00' });
      monedero = { id: Number(res.insertId), saldo: '0.00' };
    }

    const nuevo = saldoTrasAjuste(Math.round(Number(monedero.saldo) * 100), ajuste);

    await tx.update(Monederos).set({ saldo: pesos(nuevo) }).where(eq(Monederos.id, monedero.id));
    await tx.insert(MovimientosMonedero).values({
      id_monedero: monedero.id,
      tipo: ajuste.tipo === 'abono' ? 'AjusteAbono' : 'AjusteCargo',
      monto: pesos(ajuste.centavos),
      fecha: new Date(),
      motivo: ajuste.motivo,
      id_usuario: idUsuario,
    });

    return { saldo: nuevo / 100 };
  });
}

export interface SaldoCliente {
  idCliente: number;
  nombre: string;
  correo: string | null;
  saldo: number;
  ultimoMovimiento: Date | null;
}

/** Clientes con monedero, del saldo más alto al más bajo. */
export async function listarSaldos(busqueda = ''): Promise<SaldoCliente[]> {
  const texto = busqueda.trim();
  const filtro = texto ? or(like(Clientes.nombre, `%${texto}%`), like(Clientes.correo, `%${texto}%`)) : undefined;

  const rows = await db
    .select({
      idCliente: Clientes.id,
      nombre: Clientes.nombre,
      correo: Clientes.correo,
      saldo: Monederos.saldo,
      ultimoMovimiento: sql<Date | null>`MAX(${MovimientosMonedero.fecha})`,
    })
    .from(Monederos)
    .innerJoin(Clientes, eq(Clientes.id, Monederos.id_cliente))
    .leftJoin(MovimientosMonedero, eq(MovimientosMonedero.id_monedero, Monederos.id))
    .where(filtro)
    .groupBy(Clientes.id, Clientes.nombre, Clientes.correo, Monederos.saldo)
    .orderBy(desc(Monederos.saldo), Clientes.nombre)
    .limit(200);

  return rows.map((r) => ({
    ...r,
    saldo: Number(r.saldo),
    ultimoMovimiento: r.ultimoMovimiento ? new Date(r.ultimoMovimiento) : null,
  }));
}

export interface FilaReporteMes {
  periodo: string;
  recargas: number;
  consumos: number;
  reembolsos: number;
  ajustes: number;
  movimientos: number;
}

/** Agrupa los movimientos por mes y tipo; es pura para poder probarla sin base de datos. */
export function armarReporteMensual(rows: Array<{ periodo: string; tipo: string; total: number | string; cantidad: number | string }>): FilaReporteMes[] {
  const meses = new Map<string, FilaReporteMes>();

  for (const row of rows) {
    const fila = meses.get(row.periodo) ?? { periodo: row.periodo, recargas: 0, consumos: 0, reembolsos: 0, ajustes: 0, movimientos: 0 };
    const centavos = Math.round(Number(row.total) * 100);

    if ((TIPOS_RECARGA as readonly string[]).includes(row.tipo)) fila.recargas += centavos;
    else if (row.tipo === 'Descuento') fila.consumos += centavos;
    else if (row.tipo === 'Reembolso') fila.reembolsos += centavos;
    else if (row.tipo === 'AjusteAbono') fila.ajustes += centavos;
    else if (row.tipo === 'AjusteCargo') fila.ajustes -= centavos;
    fila.movimientos += Number(row.cantidad);

    meses.set(row.periodo, fila);
  }

  return [...meses.values()]
    .sort((a, b) => b.periodo.localeCompare(a.periodo))
    .map((f) => ({ ...f, recargas: f.recargas / 100, consumos: f.consumos / 100, reembolsos: f.reembolsos / 100, ajustes: f.ajustes / 100 }));
}

/** Reporte de uso de los últimos `meses` meses. */
export async function reporteMensual(meses = 6): Promise<FilaReporteMes[]> {
  const desde = new Date();
  desde.setMonth(desde.getMonth() - (meses - 1), 1);
  desde.setHours(0, 0, 0, 0);

  const periodo = sql<string>`DATE_FORMAT(${MovimientosMonedero.fecha}, '%Y-%m')`;
  const rows = await db
    .select({
      periodo,
      tipo: MovimientosMonedero.tipo,
      total: sql<string>`COALESCE(SUM(${MovimientosMonedero.monto}), 0)`,
      cantidad: sql<number>`COUNT(*)`,
    })
    .from(MovimientosMonedero)
    .where(gte(MovimientosMonedero.fecha, desde))
    .groupBy(periodo, MovimientosMonedero.tipo);

  return armarReporteMensual(rows);
}

/** Clientes que más han pagado con su monedero. */
export async function clientesQueMasUsan(limite = 5) {
  const rows = await db
    .select({
      idCliente: Clientes.id,
      nombre: Clientes.nombre,
      compras: sql<number>`COUNT(*)`,
      total: sql<string>`COALESCE(SUM(${MovimientosMonedero.monto}), 0)`,
    })
    .from(MovimientosMonedero)
    .innerJoin(Monederos, eq(Monederos.id, MovimientosMonedero.id_monedero))
    .innerJoin(Clientes, eq(Clientes.id, Monederos.id_cliente))
    .where(eq(MovimientosMonedero.tipo, 'Descuento'))
    .groupBy(Clientes.id, Clientes.nombre)
    .orderBy(desc(sql`SUM(${MovimientosMonedero.monto})`))
    .limit(limite);

  return rows.map((r) => ({ ...r, compras: Number(r.compras), total: Number(r.total) }));
}

/** Últimos ajustes manuales, para auditar quién movió saldos y por qué. */
export async function ultimosAjustes(limite = 10) {
  const rows = await db
    .select({
      id: MovimientosMonedero.id,
      fecha: MovimientosMonedero.fecha,
      tipo: MovimientosMonedero.tipo,
      monto: MovimientosMonedero.monto,
      motivo: MovimientosMonedero.motivo,
      cliente: Clientes.nombre,
    })
    .from(MovimientosMonedero)
    .innerJoin(Monederos, eq(Monederos.id, MovimientosMonedero.id_monedero))
    .innerJoin(Clientes, eq(Clientes.id, Monederos.id_cliente))
    .where(inArray(MovimientosMonedero.tipo, ['AjusteAbono', 'AjusteCargo']))
    .orderBy(desc(MovimientosMonedero.fecha), desc(MovimientosMonedero.id))
    .limit(limite);

  return rows.map((r) => ({ ...r, monto: Number(r.monto) }));
}
