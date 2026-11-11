import type { APIRoute } from 'astro';
import { CuentaError, eliminarCuentaCliente } from '../../lib/eliminarCuenta';
import { SESSION_COOKIE } from '../../lib/session';

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// La cuenta no se borra: se eliminan los datos personales y queda anonimizada e inactiva
// (ver src/lib/eliminarCuenta.ts). Pedidos, facturas y pagos se conservan para el ERP.
export const POST: APIRoute = async ({ cookies, locals }) => {
  if (!locals.user) return json(401, { error: 'No autorizado' });

  // Solo los clientes pueden eliminar su propia cuenta;
  // el personal interno debe ser desactivado por un administrador.
  if (locals.user.role !== 'cliente') {
    return json(403, { error: 'El personal interno no puede eliminar su cuenta desde aquí.' });
  }

  try {
    await eliminarCuentaCliente(locals.user.id);
    cookies.delete(SESSION_COOKIE, { path: '/' });
    return json(200, { success: true });
  } catch (error) {
    if (error instanceof CuentaError) return json(409, { error: error.message });
    console.error('Error al eliminar cuenta:', error);
    return json(500, { error: 'Ocurrió un error al eliminar tu cuenta. Intenta de nuevo.' });
  }
};
