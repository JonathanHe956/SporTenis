import type { APIRoute } from 'astro';
import { canAccessCrm, canAccessScm } from '../../lib/auth';
import { carritoAItemsVenta, clearCart, getCartItems } from '../../lib/cart';
import { getOrCreateClientId } from '../../lib/clientes';
import { DireccionError, formatearDireccion, obtenerDireccion } from '../../lib/direcciones';
import { MonederoError, SaldoInsuficienteError } from '../../lib/monedero';
import { FORMAS_PAGO, PagoError, autorizarPago, esFormaPago, idMetodoPago, type PagoAutorizado } from '../../lib/pagos';
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

  const { envio, cupon_descuento, detalles, id_cliente: bodyClientId } = body;
  const isStaff = canAccessCrm(user.role) || canAccessScm(user.role);

  // Solo el personal interno puede vender a nombre de otro cliente o fijar el envío;
  // un cliente siempre compra para sí mismo y el servidor calcula el envío.
  const clientId = isStaff && bodyClientId ? Number(bodyClientId) : await getOrCreateClientId(user.id);
  if (!clientId) return json({ error: 'No se pudo determinar el cliente.' }, 400);

  // El cliente elige monedero, tarjeta de crédito, de débito o Mercado Pago. El personal puede
  // mandar la misma forma de pago (`pago`) o el id del método, como hasta ahora.
  if (!isStaff && !esFormaPago(body.pago)) {
    return json({ error: `Elige una forma de pago: ${Object.values(FORMAS_PAGO).join(', ')}.` }, 400);
  }

  // Primero la dirección de envío (obligatoria para el cliente); solo después se procesa el pago
  let envioA: { id_direccion: number; direccion_envio: string } | null = null;
  if (!isStaff || body.id_direccion) {
    const idDireccion = Number(body.id_direccion);
    if (!Number.isInteger(idDireccion) || idDireccion <= 0) {
      return json({ error: 'Elige una dirección de envío antes de pagar.' }, 400);
    }
    try {
      const direccion = await obtenerDireccion(clientId, idDireccion);
      envioA = { id_direccion: direccion.id, direccion_envio: formatearDireccion(direccion) };
    } catch (error: unknown) {
      if (error instanceof DireccionError) return json({ error: error.message }, error.status);
      throw error;
    }
  }

  let pago: PagoAutorizado | null = null;
  try {
    // Tarjetas y Mercado Pago se autorizan (simulado) antes de registrar; el monedero se cobra dentro de la venta
    pago = esFormaPago(body.pago) ? autorizarPago(body.pago, body) : null;
  } catch (error: unknown) {
    if (error instanceof PagoError) return json({ error: error.message }, error.status);
    throw error;
  }

  const id_metodo_pago = pago ? await idMetodoPago(pago.forma) : Number(body.id_metodo_pago);
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
      id_metodo_pago,
      items,
      envio: isStaff && envio !== undefined && envio !== null ? Number(envio) : undefined,
      cupon_descuento: typeof cupon_descuento === 'string' ? cupon_descuento.trim().slice(0, 100) : null,
      referencia_pago: pago?.referencia ?? null,
      id_direccion: envioA?.id_direccion ?? null,
      direccion_envio: envioA?.direccion_envio ?? null,
    });

    if (desdeCarrito) await clearCart(clientId);

    return json({ success: true, ...venta, referencia_pago: pago?.referencia ?? null }, 201);
  } catch (error: unknown) {
    if (error instanceof VentaError) return json({ error: error.message }, error.status);
    if (error instanceof SaldoInsuficienteError) {
      return json({ error: error.message, saldo: error.saldo, total: error.total, faltante: error.faltante }, error.status);
    }
    if (error instanceof MonederoError) return json({ error: error.message }, error.status);

    console.error('Error al procesar la venta:', error);
    return json({ error: 'Error interno al procesar la venta.' }, 500);
  }
};
