import type { APIRoute } from 'astro';
import { canAccessScm } from '../../../lib/auth';
import {
  PromocionError,
  crearPromocion,
  listarPromociones,
  validarPromocion,
  type DatosPromocion,
} from '../../../lib/promociones';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// GET /api/promociones → todas las promociones con sus productos (personal del SCM)
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión.' }, 401);
  if (!canAccessScm(locals.user.role)) return json({ ok: false, error: 'No tienes acceso a las promociones.' }, 403);
  return json({ ok: true, promociones: await listarPromociones() });
};

// POST /api/promociones → alta de una promoción con sus productos
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión.' }, 401);
  if (!canAccessScm(locals.user.role)) return json({ ok: false, error: 'No tienes acceso a las promociones.' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  try {
    const id = await crearPromocion(validarPromocion(body) as DatosPromocion);
    return json({ ok: true, id }, 201);
  } catch (error: unknown) {
    if (error instanceof PromocionError) return json({ ok: false, error: error.message }, error.status);
    console.error('Error al crear promoción:', error);
    return json({ ok: false, error: 'Error interno al guardar la promoción.' }, 500);
  }
};
