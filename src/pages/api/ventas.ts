import type { APIRoute } from 'astro';
import { canAccessCrm, canAccessScm } from '../../lib/auth';
import { carritoAItemsVenta, clearCart, getCartItems } from '../../lib/cart';
import { getOrCreateClientId } from '../../lib/clientes';
import { VentaError, normalizarItems, registrarVenta } from '../../lib/ventas';

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Debes iniciar sesión para registrar una venta.' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Cuerpo de solicitud inválido.' }, 400);
  }

  const { id_metodo_pago, envio, cupon_descuento, detalles, id_cliente: bodyClientId } = body;
  const isStaff = canAccessCrm(user.role) || canAccessScm(user.role);

  // Solo el personal interno puede vender a nombre de otro cliente o fijar el envío;
  // un cliente siempre compra para sí mismo y el servidor calcula el envío.
  const clientId = isStaff && bodyClientId ? Number(bodyClientId) : await getOrCreateClientId(user.id);
  if (!clientId) return json({ error: 'No se pudo determinar el cliente.' }, 400);

  if (!id_metodo_pago) return json({ error: 'Faltan datos requeridos (id_metodo_pago).' }, 400);

  try {
    // Sin `detalles` se compra el contenido del carrito del cliente
    const desdeCarrito = detalles === undefined;
    // Los precios siempre salen del catálogo: se ignora cualquier precio enviado por el navegador
    const items = desdeCarrito
      ? carritoAItemsVenta(await getCartItems(clientId))
      : normalizarItems(detalles).map(({ id_producto, cantidad }) => ({ id_producto, cantidad }));
    if (items.length === 0) throw new VentaError('Tu carrito está vacío.');

    const venta = await registrarVenta({
      id_cliente: clientId,
      id_usuario: user.id,
      id_metodo_pago: Number(id_metodo_pago),
      items,
      envio: isStaff && envio !== undefined && envio !== null ? Number(envio) : undefined,
      cupon_descuento: typeof cupon_descuento === 'string' ? cupon_descuento.trim().slice(0, 100) : null,
    });

    if (desdeCarrito) await clearCart(clientId);

    return json({ success: true, ...venta }, 201);
  } catch (error: unknown) {
    if (error instanceof VentaError) return json({ error: error.message }, error.status);

    console.error('Error al procesar la venta:', error);
    return json({ error: 'Error interno al procesar la venta.' }, 500);
  }
};
