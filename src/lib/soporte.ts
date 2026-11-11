// Atención al cliente: calificaciones de pedidos y tickets de soporte (migración 0018).
// El cliente califica sus pedidos entregados y levanta tickets desde "Mis compras" y /cuenta/soporte;
// el personal del CRM los atiende en /crm/tickets y logística atiende los de envío en /scm/tickets.
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '../db/db';
import { Clientes, Evaluaciones, Facturas, MensajesTicket, Roles, Tickets, Usuarios, Ventas } from '../db/schema';
import { canAccessCrm, isUsuarioActivo, roleFromName } from './auth';
import { avisarTicket } from './avisosCorreo';
import { marcarNotificacionesTicketLeidas, notificarRespuestaCliente, notificarTicketNuevo } from './notificaciones';
import { esTablaInexistente } from './dbErrores';
import { cambiarEstadoOrden, esCancelable } from './ordenes';

export const TIPOS_TICKET = [
  'Retraso en la entrega',
  'Cancelación',
  'Producto dañado o incorrecto',
  'Cambio o devolución',
  'Pago o factura',
  'Otro',
] as const;
export type TipoTicket = (typeof TIPOS_TICKET)[number];

/** Tickets de envío y devoluciones: además del CRM, los atiende logística desde /scm/tickets. */
export const TIPOS_TICKET_LOGISTICA: readonly TipoTicket[] = ['Retraso en la entrega', 'Producto dañado o incorrecto', 'Cambio o devolución'];
export const esTicketLogistica = (tipo: string): boolean => (TIPOS_TICKET_LOGISTICA as readonly string[]).includes(tipo);

export const ESTADOS_TICKET = ['Abierto', 'En proceso', 'Resuelto', 'Cerrado'] as const;
export type EstadoTicket = (typeof ESTADOS_TICKET)[number];

export const PRIORIDADES_TICKET = ['Baja', 'Media', 'Alta'] as const;
export type PrioridadTicket = (typeof PRIORIDADES_TICKET)[number];

/** Días después de la entrega en los que se aceptan cambios, devoluciones y reportes de daños. */
export const DIAS_DEVOLUCION = 30;
export const MAX_MENSAJE = 2000;
export const MAX_ASUNTO = 150;
export const MAX_COMENTARIO = 1000;

export class SoporteError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const esTipoTicket = (v: unknown): v is TipoTicket => TIPOS_TICKET.includes(v as TipoTicket);
export const esEstadoTicket = (v: unknown): v is EstadoTicket => ESTADOS_TICKET.includes(v as EstadoTicket);
export const esPrioridadTicket = (v: unknown): v is PrioridadTicket => PRIORIDADES_TICKET.includes(v as PrioridadTicket);

/** Abierto o En proceso: el ticket todavía espera una solución. */
export const ticketActivo = (estado: string): boolean => estado === 'Abierto' || estado === 'En proceso';

export const folioTicket = (id: number): string => `TK-${String(id).padStart(5, '0')}`;

/** Lo que más urge (un pedido que no llega o que el cliente quiere cancelar) entra con prioridad alta. */
export const prioridadInicial = (tipo: TipoTicket): PrioridadTicket =>
  tipo === 'Retraso en la entrega' || tipo === 'Cancelación'
    ? 'Alta'
    : tipo === 'Otro'
      ? 'Baja'
      : 'Media';

/** Tipos que se refieren a un pedido concreto; pago/factura y otro pueden ser dudas generales. */
export const tipoRequierePedido = (tipo: TipoTicket): boolean => tipo !== 'Pago o factura' && tipo !== 'Otro';

export interface PedidoParaTicket {
  estado: string;
  fechaEntrega: Date | null;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Por qué no se puede levantar ese tipo de ticket para el pedido (null si sí se puede):
 * un retraso o una cancelación solo tienen sentido antes de la entrega, y un daño o una
 * devolución, en los 30 días posteriores.
 */
export function motivoTipoNoPermitido(tipo: TipoTicket, pedido: PedidoParaTicket | null, ahora = new Date()): string | null {
  if (!pedido) return tipoRequierePedido(tipo) ? 'Elige el pedido al que se refiere el ticket.' : null;

  switch (tipo) {
    case 'Retraso en la entrega':
      if (pedido.estado === 'Entregada') return 'Este pedido ya se entregó. Si llegó con algún problema, elige "Producto dañado o incorrecto".';
      if (pedido.estado === 'Cancelada') return 'Este pedido está cancelado.';
      return null;
    case 'Cancelación':
      if (pedido.estado === 'Entregada') return 'Este pedido ya se entregó. Para regresarlo, elige "Cambio o devolución".';
      if (!esCancelable(pedido.estado)) return 'Este pedido ya está cancelado.';
      return null;
    case 'Producto dañado o incorrecto':
    case 'Cambio o devolución': {
      if (pedido.estado !== 'Entregada') return 'Podrás reportarlo cuando el pedido se haya entregado.';
      const entrega = pedido.fechaEntrega ? new Date(pedido.fechaEntrega).getTime() : null;
      if (entrega !== null && ahora.getTime() - entrega > DIAS_DEVOLUCION * DIA_MS) {
        return `Pasaron más de ${DIAS_DEVOLUCION} días desde la entrega; ya no aplican cambios ni devoluciones.`;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Tipos de ticket que el cliente puede elegir para un pedido (o sin pedido). */
export const tiposPermitidos = (pedido: PedidoParaTicket | null, ahora = new Date()): TipoTicket[] =>
  TIPOS_TICKET.filter((tipo) => motivoTipoNoPermitido(tipo, pedido, ahora) === null);

/** Recorta espacios y valida largo; conserva los saltos de línea del mensaje. */
export function validarMensaje(valor: unknown, campo = 'El mensaje', min = 1): string {
  const texto = typeof valor === 'string' ? valor.replace(/\r\n/g, '\n').trim() : '';
  if (texto.length < min) {
    throw new SoporteError(min > 1 ? `${campo} debe tener al menos ${min} caracteres.` : `${campo} no puede ir vacío.`);
  }
  if (texto.length > MAX_MENSAJE) throw new SoporteError(`${campo} no puede pasar de ${MAX_MENSAJE} caracteres.`);
  return texto;
}

export interface NuevoTicket {
  tipo: TipoTicket;
  asunto: string;
  mensaje: string;
  id_venta: number | null;
}

/** Valida lo que manda el cliente (sin consultar la base); el asunto es opcional. */
export function validarNuevoTicket(body: Record<string, unknown>): NuevoTicket {
  if (!esTipoTicket(body.tipo)) throw new SoporteError('Elige el motivo del ticket.');
  const idVenta = body.id_venta === undefined || body.id_venta === null || body.id_venta === '' ? null : Number(body.id_venta);
  if (idVenta !== null && (!Number.isInteger(idVenta) || idVenta <= 0)) throw new SoporteError('El pedido no es válido.');

  const asuntoRaw = typeof body.asunto === 'string' ? body.asunto.replace(/\s+/g, ' ').trim() : '';
  if (asuntoRaw.length > MAX_ASUNTO) throw new SoporteError(`El asunto no puede pasar de ${MAX_ASUNTO} caracteres.`);
  const asunto = asuntoRaw || (idVenta ? `${body.tipo} · Pedido #${idVenta}` : body.tipo);

  return {
    tipo: body.tipo,
    asunto,
    mensaje: validarMensaje(body.mensaje, 'La descripción', 10),
    id_venta: idVenta,
  };
}

export interface NuevaCalificacion {
  calificacion: number;
  comentario: string | null;
}

export function validarCalificacion(body: Record<string, unknown>): NuevaCalificacion {
  const calificacion = Number(body.calificacion);
  if (!Number.isInteger(calificacion) || calificacion < 1 || calificacion > 5) {
    throw new SoporteError('Elige de 1 a 5 estrellas.');
  }
  const comentario = typeof body.comentario === 'string' ? body.comentario.trim() : '';
  if (comentario.length > MAX_COMENTARIO) throw new SoporteError(`El comentario no puede pasar de ${MAX_COMENTARIO} caracteres.`);
  return { calificacion, comentario: comentario || null };
}

// ── Consultas ───────────────────────────────────────────────

const pedidoDelCliente = async (clientId: number, ventaId: number) => {
  const [venta] = await db
    .select({ id: Ventas.id, estado: Ventas.estado, fechaEntrega: Ventas.fecha_entrega })
    .from(Ventas)
    .where(and(eq(Ventas.id, ventaId), eq(Ventas.id_cliente, clientId)))
    .limit(1);
  if (!venta) throw new SoporteError('No encontramos ese pedido en tu cuenta.', 404);
  return venta;
};

/** Folio de factura de cada pedido, para mostrarlo en lugar del número interno. */
const foliosDeVentas = async (ids: number[]): Promise<Map<number, string>> => {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id_venta: Facturas.id_venta, folio: Facturas.folio }).from(Facturas).where(inArray(Facturas.id_venta, ids));
  return new Map(rows.map((r) => [r.id_venta, r.folio]));
};

export interface CalificacionPedido {
  calificacion: number;
  comentario: string | null;
  fecha: Date;
}

/** Calificación que el cliente dejó a su pedido; null si no lo ha calificado o falta la migración. */
export async function calificacionDePedido(clientId: number, ventaId: number): Promise<CalificacionPedido | null> {
  try {
    const [row] = await db
      .select({ calificacion: Evaluaciones.calificacion, comentario: Evaluaciones.comentarios, fecha: Evaluaciones.fecha_evaluacion })
      .from(Evaluaciones)
      .where(and(eq(Evaluaciones.id_venta, ventaId), eq(Evaluaciones.id_cliente, clientId)))
      .limit(1);
    return row ?? null;
  } catch (error) {
    if (esColumnaOTablaInexistente(error)) return null;
    throw error;
  }
}

/** Guarda (o actualiza) la calificación del pedido. Solo se califican pedidos entregados. */
export async function calificarPedido(clientId: number, ventaId: number, datos: NuevaCalificacion): Promise<void> {
  const venta = await pedidoDelCliente(clientId, ventaId);
  if (venta.estado !== 'Entregada') throw new SoporteError('Podrás calificar el pedido cuando se haya entregado.');

  const ahora = new Date();
  await db
    .insert(Evaluaciones)
    .values({
      id_cliente: clientId,
      id_usuario: null,
      id_venta: ventaId,
      calificacion: datos.calificacion,
      comentarios: datos.comentario,
      fecha_evaluacion: ahora,
    })
    .onDuplicateKeyUpdate({ set: { calificacion: datos.calificacion, comentarios: datos.comentario, fecha_evaluacion: ahora } });
}

/** Tabla o columna de la migración 0018 todavía sin aplicar. */
export const esColumnaOTablaInexistente = (error: unknown): boolean => {
  const err = error as { code?: string; cause?: { code?: string } } | null;
  return esTablaInexistente(error) || err?.code === 'ER_BAD_FIELD_ERROR' || err?.cause?.code === 'ER_BAD_FIELD_ERROR';
};

export interface TicketResumen {
  id: number;
  folio: string;
  tipo: string;
  asunto: string;
  estado: EstadoTicket;
  prioridad: PrioridadTicket;
  idVenta: number | null;
  /** Folio de la factura del pedido o "Pedido #id". */
  pedido: string | null;
  fechaCreacion: Date;
  fechaActualizacion: Date;
  fechaResolucion: Date | null;
  /** El último mensaje es del equipo de soporte: el cliente tiene una respuesta por leer. */
  respuestaNueva: boolean;
  /** El último mensaje es del cliente: el ticket espera respuesta del equipo. */
  esperaSoporte: boolean;
  cliente?: { id: number; nombre: string; correo: string };
  asignado?: string | null;
  idAsignado?: number | null;
}

const columnasTicket = {
  id: Tickets.id,
  tipo: Tickets.tipo,
  asunto: Tickets.asunto,
  estado: Tickets.estado,
  prioridad: Tickets.prioridad,
  idVenta: Tickets.id_venta,
  fechaCreacion: Tickets.fecha_creacion,
  fechaActualizacion: Tickets.fecha_actualizacion,
  fechaResolucion: Tickets.fecha_resolucion,
  idCliente: Clientes.id,
  cliente: Clientes.nombre,
  correo: Clientes.correo,
  asignado: Usuarios.nombre,
  idAsignado: Tickets.id_usuario_asignado,
};

interface FilaTicket {
  id: number;
  tipo: string;
  asunto: string;
  estado: EstadoTicket;
  prioridad: PrioridadTicket;
  idVenta: number | null;
  fechaCreacion: Date;
  fechaActualizacion: Date;
  fechaResolucion: Date | null;
  idCliente: number;
  cliente: string;
  correo: string;
  asignado: string | null;
  idAsignado: number | null;
}

/** Agrega el folio del pedido y quién escribió el último mensaje de cada ticket. */
async function completarResumen(filas: FilaTicket[], incluirCliente: boolean): Promise<TicketResumen[]> {
  if (filas.length === 0) return [];
  const ids = filas.map((f) => f.id);
  const [folios, mensajes] = await Promise.all([
    foliosDeVentas(filas.flatMap((f) => (f.idVenta ? [f.idVenta] : []))),
    db
      .select({ id_ticket: MensajesTicket.id_ticket, autor: MensajesTicket.autor })
      .from(MensajesTicket)
      .where(inArray(MensajesTicket.id_ticket, ids))
      .orderBy(asc(MensajesTicket.id)),
  ]);
  // Último mensaje de una persona (los avisos del sistema no cuentan como respuesta)
  const ultimoAutor = new Map<number, string>();
  for (const m of mensajes) if (m.autor !== 'Sistema') ultimoAutor.set(m.id_ticket, m.autor);

  return filas.map((f) => {
    const activo = ticketActivo(f.estado);
    return {
      id: f.id,
      folio: folioTicket(f.id),
      tipo: f.tipo,
      asunto: f.asunto,
      estado: f.estado,
      prioridad: f.prioridad,
      idVenta: f.idVenta,
      pedido: f.idVenta ? folios.get(f.idVenta) ?? `Pedido #${f.idVenta}` : null,
      fechaCreacion: f.fechaCreacion,
      fechaActualizacion: f.fechaActualizacion,
      fechaResolucion: f.fechaResolucion,
      respuestaNueva: activo && ultimoAutor.get(f.id) === 'Soporte',
      esperaSoporte: activo && ultimoAutor.get(f.id) === 'Cliente',
      ...(incluirCliente
        ? { cliente: { id: f.idCliente, nombre: f.cliente, correo: f.correo }, asignado: f.asignado, idAsignado: f.idAsignado }
        : {}),
    };
  });
}

/** Tickets del cliente, los que siguen abiertos primero. Opcionalmente solo los de un pedido. */
export async function listarTicketsCliente(clientId: number, ventaId?: number): Promise<TicketResumen[]> {
  try {
    const filas = await db
      .select(columnasTicket)
      .from(Tickets)
      .innerJoin(Clientes, eq(Tickets.id_cliente, Clientes.id))
      .leftJoin(Usuarios, eq(Tickets.id_usuario_asignado, Usuarios.id))
      .where(ventaId ? and(eq(Tickets.id_cliente, clientId), eq(Tickets.id_venta, ventaId)) : eq(Tickets.id_cliente, clientId))
      .orderBy(desc(Tickets.fecha_actualizacion), desc(Tickets.id));
    const tickets = await completarResumen(filas, false);
    return tickets.sort((a, b) => Number(ticketActivo(b.estado)) - Number(ticketActivo(a.estado)));
  } catch (error) {
    if (esTablaInexistente(error)) return [];
    throw error;
  }
}

/** Tickets para el panel, del más reciente al más antiguo: todos (CRM) o solo los de logística (SCM). */
export async function listarTicketsSoporte(area: 'todos' | 'logistica' = 'todos'): Promise<TicketResumen[]> {
  const filas = await db
    .select(columnasTicket)
    .from(Tickets)
    .innerJoin(Clientes, eq(Tickets.id_cliente, Clientes.id))
    .leftJoin(Usuarios, eq(Tickets.id_usuario_asignado, Usuarios.id))
    .where(area === 'logistica' ? inArray(Tickets.tipo, [...TIPOS_TICKET_LOGISTICA]) : undefined)
    .orderBy(desc(Tickets.fecha_actualizacion), desc(Tickets.id));
  return completarResumen(filas, true);
}

export interface ContactoSoporte {
  idTicket: number;
  folio: string;
  asunto: string;
  idCliente: number;
  cliente: string;
  fecha: Date;
  /** "Ticket abierto" (el cliente lo levanta) o "Respuesta de soporte" (el equipo le contesta). */
  tipo: 'Ticket abierto' | 'Respuesta de soporte';
  /** La respuesta del equipo cuenta como contacto con el cliente (bitácora y clientes en riesgo). */
  esContacto: boolean;
  mensaje: string;
  agente: string | null;
}

/**
 * Lo que los tickets aportan a la bitácora de interacciones del CRM: cuando el cliente abre un ticket
 * y cada respuesta del equipo. Las réplicas posteriores del cliente y los avisos del sistema se quedan
 * solo en la conversación del ticket. Del más reciente al más antiguo; vacío si falta la migración 0018.
 */
export async function contactosSoporte(clientId?: number): Promise<ContactoSoporte[]> {
  let filas;
  try {
    filas = await db
      .select({
        id: MensajesTicket.id,
        idTicket: Tickets.id,
        asunto: Tickets.asunto,
        idCliente: Clientes.id,
        cliente: Clientes.nombre,
        autor: MensajesTicket.autor,
        mensaje: MensajesTicket.mensaje,
        fecha: MensajesTicket.fecha,
        agente: Usuarios.nombre,
      })
      .from(MensajesTicket)
      .innerJoin(Tickets, eq(MensajesTicket.id_ticket, Tickets.id))
      .innerJoin(Clientes, eq(Tickets.id_cliente, Clientes.id))
      .leftJoin(Usuarios, eq(MensajesTicket.id_usuario, Usuarios.id))
      .where(clientId === undefined
        ? inArray(MensajesTicket.autor, ['Cliente', 'Soporte'])
        : and(inArray(MensajesTicket.autor, ['Cliente', 'Soporte']), eq(Tickets.id_cliente, clientId)))
      .orderBy(asc(MensajesTicket.id));
  } catch (error) {
    if (esTablaInexistente(error)) return [];
    throw error;
  }

  const abiertos = new Set<number>();
  const contactos: ContactoSoporte[] = [];
  for (const f of filas) {
    // El primer mensaje de cada ticket es la descripción con la que el cliente lo abrió
    const primero = !abiertos.has(f.idTicket);
    abiertos.add(f.idTicket);
    if (f.autor === 'Cliente' && !primero) continue;
    const esContacto = f.autor === 'Soporte';
    contactos.push({
      idTicket: f.idTicket,
      folio: folioTicket(f.idTicket),
      asunto: f.asunto,
      idCliente: f.idCliente,
      cliente: f.cliente,
      fecha: f.fecha,
      tipo: esContacto ? 'Respuesta de soporte' : 'Ticket abierto',
      esContacto,
      mensaje: f.mensaje,
      agente: esContacto ? f.agente : null,
    });
  }
  return contactos.reverse();
}

export interface MensajeTicket {
  id: number;
  autor: 'Cliente' | 'Soporte' | 'Sistema';
  nombre: string | null;
  mensaje: string;
  fecha: Date;
}

export interface TicketDetalle extends TicketResumen {
  cliente: { id: number; nombre: string; correo: string };
  asignado: string | null;
  idAsignado: number | null;
  /** Estado actual del pedido ligado (para saber si todavía se puede cancelar). */
  estadoPedido: string | null;
  mensajes: MensajeTicket[];
}

/**
 * Ticket con su conversación. Con `clientId` solo lo devuelve si es de ese cliente,
 * para que nadie vea tickets ajenos cambiando el id en la URL.
 */
export async function obtenerTicket(id: number, clientId?: number): Promise<TicketDetalle | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  let filas;
  try {
    filas = await db
      .select({ ...columnasTicket, estadoPedido: Ventas.estado })
      .from(Tickets)
      .innerJoin(Clientes, eq(Tickets.id_cliente, Clientes.id))
      .leftJoin(Usuarios, eq(Tickets.id_usuario_asignado, Usuarios.id))
      .leftJoin(Ventas, eq(Tickets.id_venta, Ventas.id))
      .where(clientId === undefined ? eq(Tickets.id, id) : and(eq(Tickets.id, id), eq(Tickets.id_cliente, clientId)))
      .limit(1);
  } catch (error) {
    if (esTablaInexistente(error)) return null;
    throw error;
  }
  const fila = filas[0];
  if (!fila) return null;

  const [resumen] = await completarResumen([fila], true);
  const mensajes = await db
    .select({
      id: MensajesTicket.id,
      autor: MensajesTicket.autor,
      nombre: Usuarios.nombre,
      mensaje: MensajesTicket.mensaje,
      fecha: MensajesTicket.fecha,
    })
    .from(MensajesTicket)
    .leftJoin(Usuarios, eq(MensajesTicket.id_usuario, Usuarios.id))
    .where(eq(MensajesTicket.id_ticket, id))
    .orderBy(asc(MensajesTicket.fecha), asc(MensajesTicket.id));

  return {
    ...resumen,
    cliente: resumen.cliente!,
    asignado: resumen.asignado ?? null,
    idAsignado: fila.idAsignado,
    estadoPedido: fila.estadoPedido,
    mensajes,
  };
}

// ── Acciones del cliente ────────────────────────────────────

/** Crea el ticket con la descripción como primer mensaje. Devuelve su id. */
export async function crearTicket(clientId: number, datos: NuevoTicket): Promise<number> {
  const venta = datos.id_venta ? await pedidoDelCliente(clientId, datos.id_venta) : null;
  const motivo = motivoTipoNoPermitido(datos.tipo, venta);
  if (motivo) throw new SoporteError(motivo);

  // Un ticket abierto por motivo y pedido: el cliente sigue la conversación en el que ya tiene
  if (venta) {
    const [repetido] = await db
      .select({ id: Tickets.id })
      .from(Tickets)
      .where(and(
        eq(Tickets.id_cliente, clientId),
        eq(Tickets.id_venta, venta.id),
        eq(Tickets.tipo, datos.tipo),
        or(eq(Tickets.estado, 'Abierto'), eq(Tickets.estado, 'En proceso')),
      ))
      .limit(1);
    if (repetido) {
      throw new SoporteError(`Ya tienes el ticket ${folioTicket(repetido.id)} abierto por este motivo. Escríbenos ahí.`, 409);
    }
  }

  const ahora = new Date();
  const id = await db.transaction(async (tx) => {
    const [creado] = await tx.insert(Tickets).values({
      id_cliente: clientId,
      id_venta: venta?.id ?? null,
      tipo: datos.tipo,
      asunto: datos.asunto,
      estado: 'Abierto',
      prioridad: prioridadInicial(datos.tipo),
      fecha_creacion: ahora,
      fecha_actualizacion: ahora,
    });
    const idTicket = Number(creado.insertId);
    await tx.insert(MensajesTicket).values({ id_ticket: idTicket, autor: 'Cliente', mensaje: datos.mensaje, fecha: ahora });
    return idTicket;
  });
  avisarTicket(id, 'creado', datos.mensaje);
  const [cliente] = await db.select({ nombre: Clientes.nombre }).from(Clientes).where(eq(Clientes.id, clientId)).limit(1);
  await notificarTicketNuevo({
    folio: folioTicket(id),
    tipo: datos.tipo,
    asunto: datos.asunto,
    prioridad: prioridadInicial(datos.tipo),
    cliente: cliente?.nombre ?? 'Un cliente',
    idVenta: venta?.id ?? null,
    logistica: esTicketLogistica(datos.tipo),
  });
  return id;
}

/** El cliente responde en su ticket; si estaba resuelto se vuelve a abrir. Uno cerrado ya no acepta mensajes. */
export async function responderComoCliente(clientId: number, id: number, mensaje: string): Promise<void> {
  const [ticket] = await db
    .select({ estado: Tickets.estado, tipo: Tickets.tipo, asunto: Tickets.asunto, cliente: Clientes.nombre })
    .from(Tickets)
    .innerJoin(Clientes, eq(Tickets.id_cliente, Clientes.id))
    .where(and(eq(Tickets.id, id), eq(Tickets.id_cliente, clientId)))
    .limit(1);
  if (!ticket) throw new SoporteError('Ticket no encontrado.', 404);
  if (ticket.estado === 'Cerrado') throw new SoporteError('Este ticket está cerrado. Si necesitas más ayuda, levanta uno nuevo.');

  const ahora = new Date();
  const reabre = ticket.estado === 'Resuelto';
  await db.transaction(async (tx) => {
    await tx.insert(MensajesTicket).values({ id_ticket: id, autor: 'Cliente', mensaje, fecha: ahora });
    if (reabre) {
      await tx.insert(MensajesTicket).values({ id_ticket: id, autor: 'Sistema', mensaje: 'El cliente volvió a abrir el ticket.', fecha: ahora });
    }
    await tx
      .update(Tickets)
      .set(reabre ? { estado: 'Abierto', fecha_resolucion: null, fecha_actualizacion: ahora } : { fecha_actualizacion: ahora })
      .where(eq(Tickets.id, id));
  });
  await notificarRespuestaCliente({
    folio: folioTicket(id),
    asunto: ticket.asunto,
    cliente: ticket.cliente,
    reabierto: reabre,
    logistica: esTicketLogistica(ticket.tipo),
  });
}

// ── Acciones del personal ───────────────────────────────────

const ticketParaSoporte = async (id: number) => {
  const [ticket] = await db
    .select({
      estado: Tickets.estado,
      prioridad: Tickets.prioridad,
      tipo: Tickets.tipo,
      idVenta: Tickets.id_venta,
      idAsignado: Tickets.id_usuario_asignado,
    })
    .from(Tickets)
    .where(eq(Tickets.id, id))
    .limit(1);
  if (!ticket) throw new SoporteError('Ticket no encontrado.', 404);
  return ticket;
};

/** Al resolver o cerrar se guarda cuándo, para medir el tiempo de resolución; al reabrir se borra. */
const camposPorEstado = (estado: EstadoTicket, ahora: Date) =>
  ticketActivo(estado) ? { estado, fecha_resolucion: null } : { estado, fecha_resolucion: ahora };

/**
 * Un agente responde. Si el ticket estaba abierto pasa a "En proceso" y, si nadie lo atendía,
 * queda asignado a ese agente. Opcionalmente cambia el estado en el mismo paso.
 */
export async function responderComoSoporte(userId: number, id: number, mensaje: string, nuevoEstado?: EstadoTicket): Promise<void> {
  const ticket = await ticketParaSoporte(id);
  const ahora = new Date();
  const estado: EstadoTicket = nuevoEstado ?? (ticket.estado === 'Abierto' ? 'En proceso' : ticket.estado);

  await db.transaction(async (tx) => {
    await tx.insert(MensajesTicket).values({ id_ticket: id, autor: 'Soporte', id_usuario: userId, mensaje, fecha: ahora });
    if (nuevoEstado && nuevoEstado !== ticket.estado) {
      await tx.insert(MensajesTicket).values({ id_ticket: id, autor: 'Sistema', id_usuario: userId, mensaje: `El ticket pasó a ${nuevoEstado}.`, fecha: ahora });
    }
    await tx
      .update(Tickets)
      .set({
        ...(estado !== ticket.estado ? camposPorEstado(estado, ahora) : {}),
        id_usuario_asignado: ticket.idAsignado ?? userId,
        fecha_actualizacion: ahora,
      })
      .where(eq(Tickets.id, id));
  });
  avisarTicket(id, 'respuesta', mensaje);
  await marcarNotificacionesTicketLeidas(folioTicket(id));
}

/** Cambia estado, prioridad o agente asignado; cada cambio de estado queda en la conversación. */
export async function actualizarTicket(
  userId: number,
  id: number,
  cambios: { estado?: EstadoTicket; prioridad?: PrioridadTicket; asignarA?: number | null },
): Promise<void> {
  const ticket = await ticketParaSoporte(id);
  const ahora = new Date();
  const cambiaEstado = cambios.estado !== undefined && cambios.estado !== ticket.estado;

  await db.transaction(async (tx) => {
    if (cambiaEstado) {
      await tx.insert(MensajesTicket).values({ id_ticket: id, autor: 'Sistema', id_usuario: userId, mensaje: `El ticket pasó a ${cambios.estado}.`, fecha: ahora });
    }
    await tx
      .update(Tickets)
      .set({
        ...(cambiaEstado ? camposPorEstado(cambios.estado!, ahora) : {}),
        ...(cambios.prioridad ? { prioridad: cambios.prioridad } : {}),
        ...(cambios.asignarA !== undefined ? { id_usuario_asignado: cambios.asignarA } : {}),
        fecha_actualizacion: ahora,
      })
      .where(eq(Tickets.id, id));
  });
  if (cambiaEstado && (cambios.estado === 'Resuelto' || cambios.estado === 'Cerrado')) {
    avisarTicket(id, cambios.estado === 'Resuelto' ? 'resuelto' : 'cerrado');
    await marcarNotificacionesTicketLeidas(folioTicket(id));
  }
}

/**
 * Aprueba un ticket de cancelación: cancela el pedido con la misma lógica de /erp/ordenes (regresa
 * el stock, cancela la factura y reembolsa al monedero, a la tarjeta o en Mercado Pago) y resuelve
 * el ticket. El correo de cancelación (con el reembolso) lo manda cambiarEstadoOrden.
 */
export async function aprobarCancelacion(userId: number, id: number): Promise<void> {
  const ticket = await ticketParaSoporte(id);
  if (ticket.tipo !== 'Cancelación' || !ticket.idVenta) throw new SoporteError('Este ticket no es una solicitud de cancelación.');
  if (!ticketActivo(ticket.estado)) throw new SoporteError('El ticket ya está resuelto o cerrado.');

  const { reembolso } = await cambiarEstadoOrden(ticket.idVenta, 'Cancelada', userId);

  const ahora = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(MensajesTicket).values({
      id_ticket: id,
      autor: 'Sistema',
      id_usuario: userId,
      mensaje: `Se aprobó la cancelación y el pedido #${ticket.idVenta} quedó cancelado. ${reembolso?.mensaje ?? ''}`.trim(),
      fecha: ahora,
    });
    await tx
      .update(Tickets)
      .set({ ...camposPorEstado('Resuelto', ahora), id_usuario_asignado: ticket.idAsignado ?? userId, fecha_actualizacion: ahora })
      .where(eq(Tickets.id, id));
  });
  await marcarNotificacionesTicketLeidas(folioTicket(id));
}

/** Personal al que se puede asignar un ticket: el del CRM y, si es de envío o devolución, también logística. */
export async function agentesSoporte(tipoTicket?: string): Promise<Array<{ id: number; nombre: string }>> {
  const incluyeLogistica = tipoTicket !== undefined && esTicketLogistica(tipoTicket);
  const rows = await db
    .select({ id: Usuarios.id, nombre: Usuarios.nombre, rol: Roles.nombre, estado: Usuarios.estado })
    .from(Usuarios)
    .innerJoin(Roles, eq(Usuarios.id_rol, Roles.id))
    .orderBy(asc(Usuarios.nombre));
  return rows
    .filter((r) => {
      const rol = roleFromName(r.rol);
      return (canAccessCrm(rol) || (incluyeLogistica && rol === 'logistica')) && isUsuarioActivo(r.estado);
    })
    .map(({ id, nombre }) => ({ id, nombre }));
}
