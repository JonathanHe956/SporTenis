import type { APIRoute } from 'astro';
import { findClientId } from '../../lib/clientes';
import { SoporteError, esColumnaOTablaInexistente, calificarPedido, validarCalificacion } from '../../lib/soporte';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// POST /api/evaluaciones → { id_venta, calificacion (1-5), comentario? } califica un pedido entregado.
// Volver a enviarla para el mismo pedido actualiza la calificación.
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  try {
    const idVenta = Number(body.id_venta);
    if (!Number.isInteger(idVenta) || idVenta <= 0) throw new SoporteError('El pedido no es válido.');
    const datos = validarCalificacion(body);
    const clientId = await findClientId(locals.user.id);
    if (!clientId) throw new SoporteError('No encontramos ese pedido en tu cuenta.', 404);
    await calificarPedido(clientId, idVenta, datos);
    return json({ ok: true, ...datos });
  } catch (error: unknown) {
    if (error instanceof SoporteError) return json({ ok: false, error: error.message }, error.status);
    if (esColumnaOTablaInexistente(error)) return json({ ok: false, error: 'Las calificaciones y los tickets aún no están activos: falta aplicar la migración 0018 en la base de datos.' }, 503);
    console.error('Error al guardar la calificación:', error);
    return json({ ok: false, error: 'Error interno al guardar la calificación.' }, 500);
  }
};
