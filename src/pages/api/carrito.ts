import type { APIRoute } from 'astro';
import { CartError, clearCart, getCartItems, resumirCarrito, setCartItem } from '../../lib/cart';
import { findClientId, getOrCreateClientId } from '../../lib/clientes';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const cartResponse = async (clientId: number | null, status = 200): Promise<Response> => {
  const items = clientId ? await getCartItems(clientId) : [];
  return json({ ok: true, items, resumen: resumirCarrito(items) }, status);
};

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return json({ ok: false, error: 'Debes iniciar sesión para usar el carrito.' }, 401);

  return cartResponse(await findClientId(locals.user.id));
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
