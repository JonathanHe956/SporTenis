import type { APIRoute } from 'astro';
import { ImpuestoError, crearImpuesto, listarImpuestos, validarImpuesto, type DatosImpuesto } from '../../../lib/impuestos';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// GET /api/impuestos?activos=1 → lo que usa el checkout; sin filtro, el panel ve todos
export const GET: APIRoute = async ({ url, locals }) => {
  const soloActivos = url.searchParams.get('activos') === '1' || locals.user?.role !== 'administrador';
  return json({ ok: true, impuestos: await listarImpuestos(soloActivos) });
};

// POST /api/impuestos → alta de un impuesto (solo administrador)
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión.' }, 401);
  if (locals.user.role !== 'administrador') return json({ ok: false, error: 'Solo el administrador configura impuestos.' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  try {
    const id = await crearImpuesto(validarImpuesto(body) as DatosImpuesto);
    return json({ ok: true, id }, 201);
  } catch (error: unknown) {
    if (error instanceof ImpuestoError) return json({ ok: false, error: error.message }, error.status);
    console.error('Error al crear impuesto:', error);
    return json({ ok: false, error: 'Error interno al guardar el impuesto.' }, 500);
  }
};
