import type { APIRoute } from 'astro';
import { findClientId } from '../../lib/clientes';
import { consultarMovimientos, consultarSaldo, MonederoError } from '../../lib/monedero';
import { consultarSaldoTarjetaDemo, recargarConTarjetaDemo } from '../../lib/tarjetaDemo';
import { canjearTarjetaRegalo } from '../../lib/tarjetasRegalo';

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
    const saldoTarjetaDemo = await consultarSaldoTarjetaDemo();
    return json({ saldo, movimientos, saldoTarjetaDemo });
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

  const { action, codigo, monto, numero, vencimiento, cvv } = body as {
    action?: unknown;
    codigo?: unknown;
    monto?: unknown;
    numero?: unknown;
    vencimiento?: unknown;
    cvv?: unknown;
  };

  try {
    const clientId = await findClientId(user.id);
    if (!clientId) return json({ error: 'No se pudo determinar el cliente.' }, 400);

    if (action === 'canjear') {
      if (typeof codigo !== 'string' || codigo.length > 40) {
        return json({ error: 'Ingresa un código de tarjeta válido.' }, 400);
      }
      const resultado = await canjearTarjetaRegalo(clientId, codigo);
      return json({ success: true, ...resultado });
    }

    if (action === 'recargar-tarjeta-demo') {
      if (
        typeof monto !== 'number'
        || typeof numero !== 'string'
        || numero.length > 24
        || typeof vencimiento !== 'string'
        || vencimiento.length > 5
        || typeof cvv !== 'string'
        || cvv.length > 4
      ) {
        return json({ error: 'Revisa los datos de la tarjeta ficticia.' }, 400);
      }
      const resultado = await recargarConTarjetaDemo(clientId, monto, numero, vencimiento, cvv);
      return json({ success: true, ...resultado });
    }

    return json({ error: 'Acción no válida.' }, 400);
  } catch (error: unknown) {
    if (error instanceof MonederoError) return json({ error: error.message }, error.status);

    console.error('Error al actualizar el monedero:', error);
    return json({ error: 'Error interno al actualizar el monedero.' }, 500);
  }
};
