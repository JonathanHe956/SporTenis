import type { APIRoute } from 'astro';
import { CartError, clearCart, getCartItems, resumirCarrito, setCartItem, sincronizarConStock } from '../../lib/cart';
import { findClientId, getOrCreateClientId } from '../../lib/clientes';
import { impuestosVigentes } from '../../lib/impuestos';
import { revisarPagosPendientes } from '../../lib/mercadoPago';
import { consultarSaldo } from '../../lib/monedero';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Saldo con el que se pagará la compra; null si no se pudo leer (el cobro real lo valida el servidor)
const saldoMonedero = async (clientId: number | null): Promise<number | null> => {
  if (!clientId) return 0;
  try {
    return await consultarSaldo(clientId);
  } catch (error) {
    console.error('No se pudo leer el saldo del monedero:', error);
    return null;
  }
};

const cartResponse = async (clientId: number | null, status = 200): Promise<Response> => {
  const items = clientId ? await getCartItems(clientId) : [];
  return json({ ok: true, items, resumen: resumirCarrito(items, await impuestosVigentes()), saldo_monedero: await saldoMonedero(clientId) }, status);
};

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión para usar el carrito.' }, 401);

  const clientId = await findClientId(locals.user.id);
  if (!clientId) return cartResponse(null);

  // Si el cliente vuelve de Mercado Pago sin pasar por la página de regreso, aquí se registra su compra
  let compraConfirmada: number | null = null;
  try {
    const pago = await revisarPagosPendientes(clientId);
    if (pago?.estado === 'pagado') compraConfirmada = pago.id_venta;
  } catch (error) {
    console.error('No se pudieron revisar los pagos pendientes de Mercado Pago:', error);
  }

  // Si algo se agotó desde que se agregó, el carrito se corrige y se avisa al cliente
  const { items, avisos } = await sincronizarConStock(clientId);
  return json({
    ok: true,
    items,
    resumen: resumirCarrito(items, await impuestosVigentes()),
    avisos,
    saldo_monedero: await saldoMonedero(clientId),
    compra_confirmada: compraConfirmada,
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión para usar el carrito.' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  const clientId = await getOrCreateClientId(locals.user.id);
  if (!clientId) return json({ ok: false, error: 'No se pudo determinar el cliente.' }, 401);

  try {
    const productId = Number(body.productId);

    if (body.action === 'add') {
      await setCartItem(clientId, productId, Number(body.cantidad ?? 1), { sumar: true });
    } else if (body.action === 'set') {
      await setCartItem(clientId, productId, Number(body.cantidad));
    } else if (body.action === 'remove') {
      await setCartItem(clientId, productId, 0);
    } else if (body.action === 'clear') {
      await clearCart(clientId);
    } else {
      return json({ ok: false, error: 'Acción no válida.' }, 400);
    }

    return cartResponse(clientId);
  } catch (error: unknown) {
    if (error instanceof CartError) return json({ ok: false, error: error.message }, error.status);

    console.error('Error en el carrito:', error);
    return json({ ok: false, error: 'Error interno al actualizar el carrito.' }, 500);
  }
};
