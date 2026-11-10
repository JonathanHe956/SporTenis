import type { APIRoute } from 'astro';
import { findClientId, getOrCreateClientId } from '../../../lib/clientes';
import { DireccionError, crearDireccion, listarDirecciones, validarDireccionConCatalogo } from '../../../lib/direcciones';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// GET /api/direcciones → direcciones de envío del usuario, la principal primero
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión.' }, 401);
  const clientId = await findClientId(locals.user.id);
  return json({ ok: true, direcciones: clientId ? await listarDirecciones(clientId) : [] });
};

// POST /api/direcciones → guarda una dirección nueva (con `principal: true` pasa a ser la principal)
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  try {
    const clientId = await getOrCreateClientId(locals.user.id);
    if (!clientId) return json({ ok: false, error: 'No se pudo determinar el cliente.' }, 400);
    const id = await crearDireccion(clientId, await validarDireccionConCatalogo(body), body.principal === true);
    return json({ ok: true, id, direcciones: await listarDirecciones(clientId) }, 201);
  } catch (error: unknown) {
    if (error instanceof DireccionError) return json({ ok: false, error: error.message }, error.status);
    console.error('Error al guardar la dirección:', error);
    return json({ ok: false, error: 'Error interno al guardar la dirección.' }, 500);
  }
};
