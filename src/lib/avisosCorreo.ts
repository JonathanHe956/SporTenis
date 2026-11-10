// Correos automáticos al cliente (y al equipo de soporte). Cada función se llama después de que la
// operación se guardó y nunca la hace fallar: si el correo no sale, solo queda el error en el log.
//   - Pedidos: recibido (orden en Procesando), confirmado, entregado (invita a calificar) y cancelado
//     (dice a dónde regresa el dinero).
//   - Tickets: creado (al cliente y a CORREO_SOPORTE), respuesta del equipo, resuelto o cerrado.
//   - Cuenta: bienvenida al registrarse.
import { eq } from 'drizzle-orm';
import { db } from '../db/db';
import { Clientes, Tickets, Ventas } from '../db/schema';
import { getDetalleCompra, type CompraDetalle } from './compras';
import { enviarEnSegundoPlano, escaparHtml, parrafoSeguro, plantillaCorreo, tablaResumen, urlTienda, type Correo } from './correo';
import type { Reembolso } from './reembolsos';

export type EventoPedido = 'recibido' | 'confirmado' | 'entregado' | 'cancelado';

const pesos = (monto: number): string => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);
const primerNombre = (nombre: string): string => nombre.trim().split(/\s+/)[0] || nombre;

function articulosHtml(compra: CompraDetalle): string {
  const filas = compra.articulos.map((a) => [
    `${escaparHtml(a.nombre)}<br><span style="font-size:12px;color:#716e67;">${escaparHtml(a.variante)} · ${a.cantidad} × ${pesos(a.precioUnitario)}</span>`,
    pesos(a.subtotal),
  ] as [string, string]);
  return tablaResumen([
    ...filas,
    ['Envío', compra.envio === 0 ? 'Gratis' : pesos(compra.envio)],
    ['Total', pesos(compra.total)],
  ], true);
}

function detallesPagoEnvio(compra: CompraDetalle): string {
  const pago = compra.pago?.referencia ? `${compra.metodoPago} (${compra.pago.referencia})` : compra.metodoPago;
  return `<p style="margin:12px 0 0;"><strong>Forma de pago:</strong> ${escaparHtml(pago)}</p>
    ${compra.direccionEnvio ? `<p style="margin:8px 0 0;"><strong>Se envía a:</strong><br>${parrafoSeguro(compra.direccionEnvio)}</p>` : ''}`;
}

/** Arma el correo de un evento del pedido (exportado para las pruebas). */
export function correoPedido(evento: EventoPedido, compra: CompraDetalle, cliente: { nombre: string; correo: string }, reembolso?: Reembolso): Correo {
  const folio = compra.factura?.folio ?? `Pedido #${compra.id}`;
  const url = urlTienda(`/cuenta/compras/${compra.id}`);
  const saludo = `Hola, ${primerNombre(cliente.nombre)}:`;

  const contenido: Record<EventoPedido, { asunto: string; titulo: string; html: string; boton: string }> = {
    recibido: {
      asunto: `Recibimos tu pedido ${folio}`,
      titulo: 'Recibimos tu pedido',
      html: `<p>Registramos tu pedido <strong>${escaparHtml(folio)}</strong>. Te avisaremos en cuanto lo confirmemos.</p>${articulosHtml(compra)}${detallesPagoEnvio(compra)}`,
      boton: 'Ver mi pedido',
    },
    confirmado: {
      asunto: `¡Gracias por tu compra! Pedido ${folio}`,
      titulo: '¡Gracias por tu compra!',
      html: `<p>Tu pedido <strong>${escaparHtml(folio)}</strong> está confirmado y ya lo estamos preparando.</p>${articulosHtml(compra)}${detallesPagoEnvio(compra)}`,
      boton: 'Seguir mi pedido',
    },
    entregado: {
      asunto: `Tu pedido ${folio} fue entregado`,
      titulo: 'Tu pedido llegó',
      html: `<p>Entregamos tu pedido <strong>${escaparHtml(folio)}</strong>. ¡Esperamos que lo disfrutes!</p>
        <p>¿Nos ayudas con 10 segundos? Califica tu compra con estrellas: nos sirve muchísimo para mejorar.</p>
        <p style="font-size:12px;color:#716e67;">Si algo llegó dañado o quieres un cambio, tienes 30 días para pedirlo desde el detalle del pedido.</p>`,
      boton: 'Calificar mi pedido',
    },
    cancelado: {
      asunto: `Tu pedido ${folio} fue cancelado`,
      titulo: 'Cancelamos tu pedido',
      html: `<p>Tu pedido <strong>${escaparHtml(folio)}</strong> quedó cancelado.</p>
        <p style="background:#fff1c2;border-left:4px solid #171717;padding:12px 14px;margin:14px 0;">${escaparHtml(reembolso?.mensaje ?? 'Si se hizo algún cargo, te lo reembolsaremos por el mismo medio con el que pagaste.')}</p>
        ${articulosHtml(compra)}`,
      boton: 'Ver el pedido',
    },
  };

  const c = contenido[evento];
  const texto = [
    saludo,
    '',
    c.titulo,
    `Pedido: ${folio}`,
    ...compra.articulos.map((a) => `- ${a.nombre} (${a.variante}) x${a.cantidad}: ${pesos(a.subtotal)}`),
    `Total: ${pesos(compra.total)}`,
    ...(evento === 'cancelado' && reembolso ? ['', reembolso.mensaje] : []),
    '',
    `Ver el pedido: ${url}`,
  ].join('\n');

  return {
    para: cliente.correo,
    asunto: c.asunto,
    html: plantillaCorreo({ titulo: c.titulo, saludo, contenidoHtml: c.html, boton: { texto: c.boton, url } }),
    texto,
  };
}

/** Avisa al cliente un cambio de su pedido (se envía en segundo plano). */
export function avisarPedido(id_venta: number, evento: EventoPedido, reembolso?: Reembolso): void {
  enviarEnSegundoPlano(`pedido #${id_venta} ${evento}`, async () => {
    const [venta] = await db
      .select({ idCliente: Clientes.id, nombre: Clientes.nombre, correo: Clientes.correo })
      .from(Ventas)
      .innerJoin(Clientes, eq(Ventas.id_cliente, Clientes.id))
      .where(eq(Ventas.id, id_venta))
      .limit(1);
    if (!venta) return null;
    const compra = await getDetalleCompra(venta.idCliente, id_venta);
    return compra ? correoPedido(evento, compra, venta, reembolso) : null;
  });
}

// ── Tickets ─────────────────────────────────────────────────

export type EventoTicket = 'creado' | 'respuesta' | 'resuelto' | 'cerrado';

const folio = (id: number): string => `TK-${String(id).padStart(5, '0')}`;

/**
 * Avisa al cliente sobre su ticket. `mensaje` es lo que escribió el cliente (creado) o el agente
 * (respuesta). Al crearse, también avisa al buzón de CORREO_SOPORTE si está configurado.
 */
export function avisarTicket(id_ticket: number, evento: EventoTicket, mensaje?: string): void {
  enviarEnSegundoPlano(`ticket #${id_ticket} ${evento}`, async () => {
    const [t] = await db
      .select({
        asunto: Tickets.asunto,
        tipo: Tickets.tipo,
        estado: Tickets.estado,
        prioridad: Tickets.prioridad,
        nombre: Clientes.nombre,
        correo: Clientes.correo,
      })
      .from(Tickets)
      .innerJoin(Clientes, eq(Tickets.id_cliente, Clientes.id))
      .where(eq(Tickets.id, id_ticket))
      .limit(1);
    if (!t) return null;

    const f = folio(id_ticket);
    const url = urlTienda(`/cuenta/soporte/${id_ticket}`);
    const saludo = `Hola, ${primerNombre(t.nombre)}:`;
    const cita = mensaje
      ? `<blockquote style="margin:14px 0;padding:12px 14px;background:#f6f4ed;border-left:4px solid #f7d21c;">${parrafoSeguro(mensaje)}</blockquote>`
      : '';
    const resueltoAhora = t.estado === 'Resuelto';
    const cerradoAhora = t.estado === 'Cerrado';

    const textos: Record<EventoTicket, { asunto: string; titulo: string; html: string }> = {
      creado: {
        asunto: `Recibimos tu ticket ${f}: ${t.asunto}`,
        titulo: 'Recibimos tu ticket',
        html: `<p>Abrimos el ticket <strong>${f}</strong> (${escaparHtml(t.tipo)}). Te responderemos lo antes posible, normalmente en menos de 24 horas.</p>${cita}`,
      },
      respuesta: {
        asunto: `Respuesta a tu ticket ${f}`,
        titulo: 'Te respondimos',
        html: `<p>Nuestro equipo respondió tu ticket <strong>${f}</strong> · ${escaparHtml(t.asunto)}:</p>${cita}
          ${resueltoAhora ? '<p>Lo marcamos como <strong>resuelto</strong>. Si todavía necesitas ayuda, respóndenos desde tu cuenta y lo volvemos a abrir.</p>' : ''}
          ${cerradoAhora ? '<p>Con esto cerramos el ticket. Si necesitas algo más, levanta uno nuevo desde tu cuenta.</p>' : ''}`,
      },
      resuelto: {
        asunto: `Tu ticket ${f} fue resuelto`,
        titulo: 'Resolvimos tu ticket',
        html: `<p>Marcamos como resuelto tu ticket <strong>${f}</strong> · ${escaparHtml(t.asunto)}.</p><p>Si todavía no queda resuelto, respóndenos desde tu cuenta y lo volvemos a abrir.</p>`,
      },
      cerrado: {
        asunto: `Tu ticket ${f} se cerró`,
        titulo: 'Cerramos tu ticket',
        html: `<p>Cerramos tu ticket <strong>${f}</strong> · ${escaparHtml(t.asunto)}.</p><p>Si necesitas algo más, levanta un ticket nuevo desde tu cuenta.</p>`,
      },
    };
    const x = textos[evento];
    const correos: Correo[] = [{
      para: t.correo,
      asunto: x.asunto,
      html: plantillaCorreo({ titulo: x.titulo, saludo, contenidoHtml: x.html, boton: { texto: 'Ver mi ticket', url } }),
      texto: [saludo, '', x.titulo, `Ticket ${f}: ${t.asunto}`, ...(mensaje ? ['', mensaje] : []), '', `Ver el ticket: ${url}`].join('\n'),
    }];

    const buzonSoporte = process.env.CORREO_SOPORTE?.trim();
    if (evento === 'creado' && buzonSoporte) {
      const urlCrm = urlTienda(`/crm/tickets/${id_ticket}`);
      correos.push({
        para: buzonSoporte,
        asunto: `[${t.prioridad}] Nuevo ticket ${f}: ${t.asunto}`,
        html: plantillaCorreo({
          titulo: `Nuevo ticket ${f}`,
          contenidoHtml: `${tablaResumen([
            ['Cliente', `${escaparHtml(t.nombre)} &lt;${escaparHtml(t.correo)}&gt;`],
            ['Motivo', escaparHtml(t.tipo)],
            ['Prioridad', escaparHtml(t.prioridad)],
          ])}${cita}`,
          boton: { texto: 'Atender en el CRM', url: urlCrm },
        }),
        texto: `Nuevo ticket ${f} (${t.prioridad}) de ${t.nombre} <${t.correo}>\n${t.tipo}: ${t.asunto}\n\n${mensaje ?? ''}\n\n${urlCrm}`,
      });
    }
    return correos;
  });
}

// ── Cuenta ──────────────────────────────────────────────────

/** Bienvenida a un cliente recién registrado. */
export function avisarBienvenida(cliente: { nombre: string; correo: string }): void {
  enviarEnSegundoPlano(`bienvenida ${cliente.correo}`, async () => {
    const saludo = `Hola, ${primerNombre(cliente.nombre)}:`;
    const url = urlTienda('/');
    return {
      para: cliente.correo,
      asunto: 'Bienvenido a SporTenis',
      html: plantillaCorreo({
        titulo: '¡Bienvenido a SporTenis!',
        saludo,
        contenidoHtml: `<p>Tu cuenta quedó lista. Desde ella puedes seguir tus pedidos, guardar tus direcciones, usar tu monedero y pedirnos ayuda cuando la necesites.</p>
          <p>Te escribiremos a este correo para confirmar tus compras y avisarte cada vez que tu pedido cambie de estado.</p>`,
        boton: { texto: 'Ir a la tienda', url },
      }),
      texto: `${saludo}\n\nTu cuenta de SporTenis quedó lista. Te escribiremos a este correo para confirmar tus compras y avisarte cómo van tus pedidos.\n\n${url}`,
    };
  });
}
