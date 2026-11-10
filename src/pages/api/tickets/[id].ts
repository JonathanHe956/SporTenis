import type { APIRoute } from 'astro';
import { findClientId } from '../../../lib/clientes';
import { SoporteError, esColumnaOTablaInexistente, obtenerTicket, responderComoCliente, validarMensaje } from '../../../lib/soporte';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Cliente dueño del ticket; cada operación revisa que el ticket sea suyo. */
type Contexto = { error: Response } | { clientId: number; id: number };

const contexto = async (locals: App.Locals, idParam: string | undefined): Promise<Contexto> => {
  if (!locals.user) return { error: json({ ok: false, error: 'Debes iniciar sesión.' }, 401) };
  const id = Number(idParam);
  const clientId = await findClientId(locals.user.id);
  if (!Number.isInteger(id) || id <= 0 || !clientId) return { error: json({ ok: false, error: 'Ticket no encontrado.' }, 404) };
  return { clientId, id };
};

// GET /api/tickets/{id} → ticket con su conversación
export const GET: APIRoute = async ({ params, locals }) => {
  const ctx = await contexto(locals, params.id);
  if ('error' in ctx) return ctx.error;
  const ticket = await obtenerTicket(ctx.id, ctx.clientId);
  return ticket ? json({ ok: true, ticket }) : json({ ok: false, error: 'Ticket no encontrado.' }, 404);
};

// POST /api/tickets/{id} → { mensaje } el cliente responde; un ticket resuelto se vuelve a abrir
export const POST: APIRoute = async ({ params, request, locals }) => {
  const ctx = await contexto(locals, params.id);
  if ('error' in ctx) return ctx.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  try {
    await responderComoCliente(ctx.clientId, ctx.id, validarMensaje(body.mensaje));
    return json({ ok: true, ticket: await obtenerTicket(ctx.id, ctx.clientId) });
  } catch (error: unknown) {
    if (error instanceof SoporteError) return json({ ok: false, error: error.message }, error.status);
    if (esColumnaOTablaInexistente(error)) return json({ ok: false, error: 'Las calificaciones y los tickets aún no están activos: falta aplicar la migración 0018 en la base de datos.' }, 503);
    console.error('Error al responder el ticket:', error);
    return json({ ok: false, error: 'Error interno al enviar el mensaje.' }, 500);
  }
};
