import type { APIRoute } from 'astro';
import { findClientId, getOrCreateClientId } from '../../../lib/clientes';
import { SoporteError, esColumnaOTablaInexistente, crearTicket, folioTicket, listarTicketsCliente, validarNuevoTicket } from '../../../lib/soporte';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// GET /api/tickets → tickets de soporte del cliente, los abiertos primero
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión.' }, 401);
  const clientId = await findClientId(locals.user.id);
  return json({ ok: true, tickets: clientId ? await listarTicketsCliente(clientId) : [] });
};

// POST /api/tickets → { tipo, id_venta?, asunto?, mensaje } levanta un ticket nuevo
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  try {
    const datos = validarNuevoTicket(body);
    const clientId = await getOrCreateClientId(locals.user.id);
    if (!clientId) return json({ ok: false, error: 'No se pudo determinar el cliente.' }, 400);
    const id = await crearTicket(clientId, datos);
    return json({ ok: true, id, folio: folioTicket(id) }, 201);
  } catch (error: unknown) {
    if (error instanceof SoporteError) return json({ ok: false, error: error.message }, error.status);
    if (esColumnaOTablaInexistente(error)) return json({ ok: false, error: 'Las calificaciones y los tickets aún no están activos: falta aplicar la migración 0018 en la base de datos.' }, 503);
    console.error('Error al crear el ticket:', error);
    return json({ ok: false, error: 'Error interno al crear el ticket.' }, 500);
  }
};
