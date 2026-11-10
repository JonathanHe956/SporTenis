import type { APIRoute } from 'astro';
import { ImpuestoError, actualizarImpuesto, validarImpuesto } from '../../../lib/impuestos';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// PUT /api/impuestos/{id} → cambia nombre, porcentaje o estado (solo administrador)
export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión.' }, 401);
  if (locals.user.role !== 'administrador') return json({ ok: false, error: 'Solo el administrador configura impuestos.' }, 403);

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: 'Impuesto inválido.' }, 400);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  try {
    await actualizarImpuesto(id, validarImpuesto(body, true));
    return json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof ImpuestoError) return json({ ok: false, error: error.message }, error.status);
    console.error('Error al actualizar impuesto:', error);
    return json({ ok: false, error: 'Error interno al guardar el impuesto.' }, 500);
  }
};
