import type { APIRoute } from 'astro';
import { MonederoError } from '../../../lib/monedero';
import { ajustarSaldo, listarSaldos, reporteMensual, validarAjuste } from '../../../lib/monederoAdmin';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// El monedero es dinero de los clientes: solo el administrador lo consulta y lo ajusta
const soloAdministrador = (locals: App.Locals): Response | null => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión.' }, 401);
  if (locals.user.role !== 'administrador') return json({ ok: false, error: 'Solo el administrador gestiona los monederos.' }, 403);
  return null;
};

// GET /api/erp/monedero?q=texto → saldos de los clientes y reporte de uso por mes
export const GET: APIRoute = async ({ url, locals }) => {
  const denegado = soloAdministrador(locals);
  if (denegado) return denegado;

  const [saldos, reporte] = await Promise.all([listarSaldos(url.searchParams.get('q') ?? ''), reporteMensual(6)]);
  return json({ ok: true, saldos, reporte });
};

// POST /api/erp/monedero → ajuste manual { id_cliente, tipo: 'abono' | 'cargo', monto, motivo }
export const POST: APIRoute = async ({ request, locals }) => {
  const denegado = soloAdministrador(locals);
  if (denegado) return denegado;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  try {
    const { saldo } = await ajustarSaldo(validarAjuste(body), locals.user!.id);
    return json({ ok: true, saldo });
  } catch (error: unknown) {
    if (error instanceof MonederoError) return json({ ok: false, error: error.message }, error.status);
    console.error('Error al ajustar el monedero:', error);
    return json({ ok: false, error: 'Error interno al ajustar el saldo.' }, 500);
  }
};
