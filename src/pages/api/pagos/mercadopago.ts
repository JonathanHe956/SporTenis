import type { APIRoute } from 'astro';
import { resumirCarrito, sincronizarConStock } from '../../../lib/cart';
import { findClientId } from '../../../lib/clientes';
import { DireccionError, formatearDireccion, obtenerDireccion } from '../../../lib/direcciones';
import { impuestosVigentes } from '../../../lib/impuestos';
import { MercadoPagoError, crearCheckoutMercadoPago } from '../../../lib/mercadoPago';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// POST /api/pagos/mercadopago { id_direccion } → { url } de la página de pago oficial de Mercado Pago.
// La venta se registra después, cuando la API de Mercado Pago confirma el pago (ver lib/mercadoPago.ts).
export const POST: APIRoute = async ({ request, locals, url }) => {
  const user = locals.user;
  if (!user) return json({ ok: false, error: 'Debes iniciar sesión para pagar.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  const clientId = await findClientId(user.id);
  if (!clientId) return json({ ok: false, error: 'Tu carrito está vacío.' }, 400);

  try {
    // Primero la dirección de envío, igual que con las demás formas de pago
    const idDireccion = Number(body.id_direccion);
    if (!Number.isInteger(idDireccion) || idDireccion <= 0) {
      return json({ ok: false, error: 'Elige una dirección de envío antes de pagar.' }, 400);
    }
    const direccion = await obtenerDireccion(clientId, idDireccion);

    // Si algo se agotó desde que se agregó, no se manda a pagar: el cliente revisa su carrito
    const { items, avisos } = await sincronizarConStock(clientId);
    if (avisos.length > 0) return json({ ok: false, error: avisos.join(' '), avisos }, 409);
    if (items.length === 0) return json({ ok: false, error: 'Tu carrito está vacío.' }, 400);

    const checkout = await crearCheckoutMercadoPago({
      id_cliente: clientId,
      id_usuario: user.id,
      id_direccion: direccion.id,
      direccion_envio: formatearDireccion(direccion),
      items,
      resumen: resumirCarrito(items, await impuestosVigentes()),
      // Por el túnel es https://…trycloudflare.com: Mercado Pago regresará al cliente ahí
      origen: url.origin,
    });
    return json({ ok: true, url: checkout.url });
  } catch (error: unknown) {
    if (error instanceof DireccionError || error instanceof MercadoPagoError) {
      return json({ ok: false, error: error.message }, error.status);
    }
    console.error('Error al iniciar el pago con Mercado Pago:', error);
    return json({ ok: false, error: 'No se pudo iniciar el pago con Mercado Pago.' }, 500);
  }
};
