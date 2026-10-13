import { and, eq, gte, lt } from 'drizzle-orm';
import { db } from '../db/db';
import { Facturas, Notificaciones, Pagos, ReportesProgramados, Ventas } from '../db/schema';
import { ESTADOS_VENTA_EFECTIVA } from './ventas';

const INTERVALO_REVISION_MS = 60 * 60 * 1000;

const toClave = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Semana completa más reciente (lunes a domingo) anterior a `hoy`; `hasta` es exclusivo. */
export const semanaAnterior = (hoy: Date): { desde: Date; hasta: Date; inicio: string; fin: string } => {
  const diasDesdeLunes = (hoy.getDay() + 6) % 7;
  const hasta = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - diasDesdeLunes);
  const desde = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate() - 7);
  const domingo = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate() - 1);
  return { desde, hasta, inicio: toClave(desde), fin: toClave(domingo) };
};

/**
 * Genera el reporte de la semana anterior si todavía no existe y lo envía al panel
 * como notificación. Devuelve false cuando el reporte de esa semana ya estaba generado.
 */
export async function generarReporteSemanal(hoy = new Date()): Promise<boolean> {
  const { desde, hasta, inicio, fin } = semanaAnterior(hoy);

  const existente = await db
    .select({ id: ReportesProgramados.id })
    .from(ReportesProgramados)
    .where(eq(ReportesProgramados.periodo_inicio, inicio));
  if (existente.length > 0) return false;

  const enSemana = and(gte(Ventas.fecha_venta, desde), lt(Ventas.fecha_venta, hasta));
  const ordenes = await db.select({ estado: Ventas.estado, total: Ventas.total }).from(Ventas).where(enSemana);
  const facturas = await db
    .select({ id: Facturas.id })
    .from(Facturas)
    .where(and(gte(Facturas.fecha_emision, desde), lt(Facturas.fecha_emision, hasta)));
  const pagos = await db
    .select({ estado: Pagos.estado })
    .from(Pagos)
    .where(and(gte(Pagos.fecha_pago, desde), lt(Pagos.fecha_pago, hasta)));

  const ventas = ordenes.filter((o) => ESTADOS_VENTA_EFECTIVA.includes(o.estado));
  const ingresos = ventas.reduce((cents, v) => cents + Math.round(Number(v.total) * 100), 0) / 100;
  const conciliados = pagos.filter((p) => p.estado === 'Conciliado').length;
  const conDiferencia = pagos.filter((p) => p.estado === 'Con diferencia').length;

  try {
    await db.insert(ReportesProgramados).values({
      periodo_inicio: inicio,
      periodo_fin: fin,
      ordenes: ordenes.length,
      ventas: ventas.length,
      ingresos: ingresos.toFixed(2),
      facturas_emitidas: facturas.length,
      pagos_conciliados: conciliados,
      pagos_con_diferencia: conDiferencia,
      fecha_generacion: new Date(),
    });
  } catch (error: any) {
    // Otra revisión generó el mismo periodo al mismo tiempo
    if (error?.code === 'ER_DUP_ENTRY' || error?.cause?.code === 'ER_DUP_ENTRY') return false;
    throw error;
  }

  const moneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(ingresos);
  await db.insert(Notificaciones).values({
    tipo: 'reporte_programado',
    titulo: `📊 Reporte semanal ${inicio} a ${fin}`,
    mensaje: `${ventas.length} ventas por ${moneda} en ${ordenes.length} órdenes. ${facturas.length} facturas emitidas, ${conciliados} cobros conciliados y ${conDiferencia} con diferencia. Consulta el detalle en Reportes ERP.`,
    leida: false,
    fecha_creacion: new Date(),
  });

  return true;
}

/**
 * Arranca el calendario de reportes: revisa al iniciar el servidor y después cada hora
 * si ya terminó una semana que aún no tiene reporte.
 */
export function iniciarReportesProgramados(): void {
  const estado = globalThis as typeof globalThis & { __reportesProgramados?: boolean };
  if (estado.__reportesProgramados) return;
  estado.__reportesProgramados = true;

  const revisar = () => {
    generarReporteSemanal().catch((error) => console.error('Error al generar el reporte programado:', error));
  };
  revisar();
  setInterval(revisar, INTERVALO_REVISION_MS).unref();
}
