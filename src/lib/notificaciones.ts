// Notificaciones de la campana del panel interno (tabla Notificaciones). Además de las de inventario
// (stock_bajo, pedido_auto) y reportes (reporte_programado), los tickets de soporte avisan aquí:
//   - ticket_nuevo: un cliente levantó un ticket.
//   - ticket_respuesta: el cliente respondió en un ticket y espera respuesta del equipo.
//   - devolucion_monedero: un cliente eliminó su cuenta con saldo en el monedero y hay que devolvérselo.
// Las de tickets solo las ven los roles que pueden atenderlos: el CRM todas, y logística las de envío
// y devoluciones (tipo ticket_logistica_*). Se marcan como leídas solas cuando alguien responde,
// resuelve o cierra el ticket. Las devoluciones de saldo solo las ve el administrador.
import { and, eq, like, ne, not, or, type SQL } from 'drizzle-orm';
import { db } from '../db/db';
import { Notificaciones } from '../db/schema';
import { canAccessCrm, type UserRole } from './auth';

export const NOTIF_TICKET_NUEVO = 'ticket_nuevo';
export const NOTIF_TICKET_RESPUESTA = 'ticket_respuesta';
export const NOTIF_TICKET_LOGISTICA_NUEVO = 'ticket_logistica_nuevo';
export const NOTIF_TICKET_LOGISTICA_RESPUESTA = 'ticket_logistica_respuesta';
export const NOTIF_DEVOLUCION_MONEDERO = 'devolucion_monedero';

const esDeTicket = (tipo: string): boolean => tipo.startsWith('ticket_');

// En los títulos el folio siempre va entre espacios, así "TK-10001" no coincide con "TK-100012"
const delFolio = (folio: string): string => `% ${folio} %`;

/**
 * Condición extra para la consulta: el CRM ve todas las de tickets, logística solo las de envío y
 * devoluciones, y los demás roles ninguna. Las devoluciones de saldo solo las ve el administrador.
 */
export function filtroNotificacionesPorRol(role: UserRole | null | undefined): SQL | undefined {
  if (role === 'administrador') return undefined;
  const sinDevoluciones = ne(Notificaciones.tipo, NOTIF_DEVOLUCION_MONEDERO);
  if (canAccessCrm(role)) return sinDevoluciones;
  const sinTickets = not(like(Notificaciones.tipo, 'ticket\\_%'));
  const tickets = role === 'logistica' ? or(sinTickets, like(Notificaciones.tipo, 'ticket\\_logistica\\_%')) : sinTickets;
  return and(tickets, sinDevoluciones);
}

/**
 * Botón de acción de cada notificación; el de un ticket abre ese ticket (su folio va en el título)
 * en la bandeja del rol: la del CRM o, para logística, la del SCM.
 */
export function accionNotificacion(
  n: { tipo: string; titulo: string },
  role?: UserRole | null,
): { enlace: string; texto: string } | null {
  if (n.tipo === 'stock_bajo') return { enlace: '/scm/pedidos', texto: 'Crear Pedido Manual' };
  if (n.tipo === 'reporte_programado') return { enlace: '/erp/reportes', texto: 'Ver reporte' };
  if (n.tipo === NOTIF_DEVOLUCION_MONEDERO) {
    const cliente = /Cliente #(\d+)/.exec(n.titulo);
    return cliente ? { enlace: `/crm/clientes/${Number(cliente[1])}`, texto: 'Ver cliente' } : null;
  }
  if (esDeTicket(n.tipo)) {
    const folio = /TK-(\d+)/.exec(n.titulo);
    const bandeja = canAccessCrm(role) ? '/crm/tickets' : '/scm/tickets';
    return { enlace: folio ? `${bandeja}/${Number(folio[1])}` : bandeja, texto: 'Atender ticket' };
  }
  return null;
}

/** Clase visual de la notificación en la campana. */
export const claseNotificacion = (tipo: string): string =>
  tipo === 'pedido_auto' ? 'notif-auto' : esDeTicket(tipo) ? 'notif-ticket' : 'notif-alerta';

/** Un fallo al notificar nunca debe deshacer la operación del ticket: solo queda en el log. */
const sinRomper = async (descripcion: string, tarea: () => Promise<unknown>): Promise<void> => {
  try {
    await tarea();
  } catch (error) {
    console.error(`[notificaciones] No se pudo ${descripcion}:`, error);
  }
};

export function notificarTicketNuevo(t: {
  folio: string;
  tipo: string;
  asunto: string;
  prioridad: string;
  cliente: string;
  idVenta: number | null;
  /** Envío o devolución: también le llega a logística. */
  logistica: boolean;
}): Promise<void> {
  return sinRomper(`avisar del ticket ${t.folio}`, () =>
    db.insert(Notificaciones).values({
      tipo: t.logistica ? NOTIF_TICKET_LOGISTICA_NUEVO : NOTIF_TICKET_NUEVO,
      titulo: `🎫 Nuevo ticket ${t.folio} · prioridad ${t.prioridad.toLowerCase()}`,
      mensaje: `${t.cliente} levantó un ticket por "${t.tipo}"${t.idVenta ? ` del pedido #${t.idVenta}` : ''}: ${t.asunto}`.slice(0, 500),
      leida: false,
      fecha_creacion: new Date(),
    }));
}

/** El cliente respondió; si ya hay un aviso sin leer de ese ticket no se repite. */
export function notificarRespuestaCliente(t: {
  folio: string;
  asunto: string;
  cliente: string;
  reabierto: boolean;
  logistica: boolean;
}): Promise<void> {
  return sinRomper(`avisar de la respuesta en ${t.folio}`, async () => {
    const [pendiente] = await db
      .select({ id: Notificaciones.id })
      .from(Notificaciones)
      .where(and(eq(Notificaciones.leida, false), like(Notificaciones.tipo, 'ticket\\_%'), like(Notificaciones.titulo, delFolio(t.folio))))
      .limit(1);
    if (pendiente) return;
    await db.insert(Notificaciones).values({
      tipo: t.logistica ? NOTIF_TICKET_LOGISTICA_RESPUESTA : NOTIF_TICKET_RESPUESTA,
      titulo: `💬 ${t.reabierto ? 'Ticket reabierto' : 'El cliente respondió'} ${t.folio} · ${t.cliente}`.slice(0, 255),
      mensaje: `${t.cliente} escribió en "${t.asunto}" y espera respuesta del equipo.`.slice(0, 500),
      leida: false,
      fecha_creacion: new Date(),
    });
  });
}

/** Al atender el ticket (respuesta, resuelto, cerrado o cancelación aprobada) sus avisos dejan de estar pendientes. */
export function marcarNotificacionesTicketLeidas(folio: string): Promise<void> {
  return sinRomper(`marcar como leídas las notificaciones de ${folio}`, () =>
    db
      .update(Notificaciones)
      .set({ leida: true })
      .where(and(eq(Notificaciones.leida, false), like(Notificaciones.tipo, 'ticket\\_%'), like(Notificaciones.titulo, delFolio(folio)))));
}
