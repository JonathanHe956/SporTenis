import type { APIRoute } from 'astro';
import { MonederoError } from '../../lib/monedero';
import { generarTarjetasRegalo } from '../../lib/tarjetasRegalo';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// POST /api/tarjetas-regalo { cantidad } → genera un lote de tarjetas de $2,000 (solo administrador).
// Se usa desde SCM › Promociones e IVA.
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión.' }, 401);
  if (locals.user.role !== 'administrador') {
    return json({ ok: false, error: 'Solo el administrador genera tarjetas de regalo.' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  try {
    const { lote, codigos } = await generarTarjetasRegalo(Number(body.cantidad), locals.user.id);
    return json({ ok: true, lote, codigos }, 201);
  } catch (error: unknown) {
    if (error instanceof MonederoError) return json({ ok: false, error: error.message }, error.status);
    console.error('Error al generar tarjetas de regalo:', error);
    return json({ ok: false, error: 'Error interno al generar las tarjetas.' }, 500);
  }
};
