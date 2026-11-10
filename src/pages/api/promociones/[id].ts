import type { APIRoute } from 'astro';
import { canAccessScm } from '../../../lib/auth';
import { PromocionError, actualizarPromocion, eliminarPromocion, validarPromocion } from '../../../lib/promociones';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const sinPermiso = (locals: App.Locals): Response | null => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión.' }, 401);
  if (!canAccessScm(locals.user.role)) return json({ ok: false, error: 'No tienes acceso a las promociones.' }, 403);
  return null;
};

const leerId = (valor: string | undefined): number | null => {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const errorResponse = (error: unknown, accion: string): Response => {
  if (error instanceof PromocionError) return json({ ok: false, error: error.message }, error.status);
  console.error(`Error al ${accion} promoción:`, error);
  return json({ ok: false, error: `Error interno al ${accion} la promoción.` }, 500);
};

// PUT /api/promociones/{id} → cambia datos, productos o estado (envío parcial permitido)
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const denegado = sinPermiso(locals);
  if (denegado) return denegado;

  const id = leerId(params.id);
  if (!id) return json({ ok: false, error: 'Promoción inválida.' }, 400);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  try {
    await actualizarPromocion(id, validarPromocion(body, true));
    return json({ ok: true });
  } catch (error: unknown) {
    return errorResponse(error, 'actualizar');
  }
};

// DELETE /api/promociones/{id} → borra la promoción y sus asignaciones
export const DELETE: APIRoute = async ({ params, locals }) => {
  const denegado = sinPermiso(locals);
  if (denegado) return denegado;

  const id = leerId(params.id);
  if (!id) return json({ ok: false, error: 'Promoción inválida.' }, 400);

  try {
    await eliminarPromocion(id);
    return json({ ok: true });
  } catch (error: unknown) {
    return errorResponse(error, 'eliminar');
  }
};
