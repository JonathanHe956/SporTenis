import type { APIRoute } from 'astro';
import { findClientId, getOrCreateClientId } from '../../lib/clientes';
import { consultarMovimientos, consultarSaldo, descontar, MonederoError, recargar } from '../../lib/monedero';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Debes iniciar sesión para consultar tu monedero.' }, 401);

  try {
    const clientId = await findClientId(user.id);
    const saldo = clientId ? await consultarSaldo(clientId) : 0;
    const movimientos = clientId ? await consultarMovimientos(clientId) : [];
    return json({ saldo, movimientos });
  } catch (error: unknown) {
    console.error('Error al consultar el monedero:', error);
    return json({ error: 'Error interno al consultar el monedero.' }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Debes iniciar sesión para modificar tu monedero.' }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Cuerpo de solicitud inválido.' }, 400);
  }
  if (typeof body !== 'object' || body === null) {
    return json({ error: 'Cuerpo de solicitud inválido.' }, 400);
  }

  const { action, monto } = body as { action?: unknown; monto?: unknown };
  if (action !== 'recargar' && action !== 'descontar') {
    return json({ error: 'Acción no válida.' }, 400);
  }
  if (typeof monto !== 'number') {
    return json({ error: 'El monto debe ser un número.' }, 400);
  }

  try {
    const clientId = await getOrCreateClientId(user.id);
    if (!clientId) return json({ error: 'No se pudo determinar el cliente.' }, 400);

    if (action === 'recargar') {
      await recargar(clientId, monto);
    } else {
      await descontar(clientId, monto);
    }

    return json({ success: true, saldo: await consultarSaldo(clientId) });
  } catch (error: unknown) {
    if (error instanceof MonederoError) return json({ error: error.message }, error.status);

    console.error('Error al actualizar el monedero:', error);
    return json({ error: 'Error interno al actualizar el monedero.' }, 500);
  }
};
