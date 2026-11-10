// Pago con Mercado Pago usando Checkout Pro (la página de pago oficial) y el SDK oficial `mercadopago`.
//
// 1. crearCheckoutMercadoPago: guarda una copia del carrito y crea la "preferencia" de pago; el cliente
//    se va a la página de Mercado Pago (init_point).
// 2. Al volver (/checkout/mercadopago) o al llegar el webhook, procesarPagoMercadoPago consulta el pago
//    a la API de Mercado Pago —nunca se confía en lo que diga el navegador— y, si está aprobado y por el
//    monto correcto, registra la venta. Si la venta no se puede registrar (p. ej. se agotó el stock),
//    el pago se reembolsa automáticamente.
//
// Configuración en .env:  MP_ACCESS_TOKEN (obligatorio), MP_WEBHOOK_SECRET (opcional), SITE_URL.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { MercadoPagoConfig, Payment, PaymentRefund, Preference } from 'mercadopago';
import { db } from '../db/db';
import { CheckoutsMercadoPago } from '../db/schema';
import { clearCart, type CartItem, type CartSummary } from './cart';
import { idMetodoPago } from './pagos';
import { registrarVenta } from './ventas';

export class MercadoPagoError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'MercadoPagoError';
    this.status = status;
  }
}

const accessToken = (): string => process.env.MP_ACCESS_TOKEN?.trim() ?? '';

/** Mercado Pago solo aparece como forma de pago si hay un access token configurado. */
export const mercadoPagoConfigurado = (): boolean => accessToken().length > 0;

/**
 * URL pública de la tienda, para las páginas de regreso y el webhook. Si el cliente entró por una
 * dirección https (el túnel de npm run tunel o el sitio publicado) se usa esa, así no hay que editar
 * SITE_URL cada vez que cambia el túnel; si no, la de SITE_URL.
 * Astro solo reporta el host del túnel si coincide con security.allowedDomains (astro.config.mjs).
 */
export const urlSitio = (origenSolicitud?: string): string => {
  if (origenSolicitud?.startsWith('https://')) return origenSolicitud.replace(/\/+$/, '');
  return (process.env.SITE_URL?.trim() || 'http://localhost:4321').replace(/\/+$/, '');
};

const cliente = (): MercadoPagoConfig => {
  if (!mercadoPagoConfigurado()) {
    throw new MercadoPagoError('Mercado Pago no está configurado en la tienda (falta MP_ACCESS_TOKEN).', 503);
  }
  return new MercadoPagoConfig({ accessToken: accessToken(), options: { timeout: 10000 } });
};

interface ArticuloCheckout {
  id_producto: number;
  cantidad: number;
  precio: number;
  titulo: string;
}

const aCentavos = (monto: number): number => Math.round(monto * 100);

/**
 * Fecha con la zona horaria explícita ("2026-11-10T18:36:17.000-06:00"), el formato que pide
 * Mercado Pago: con la "Z" de toISOString() guarda la hora corrida y la preferencia nace vencida.
 */
export const fechaConZona = (fecha: Date): string => {
  const dos = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const offset = -fecha.getTimezoneOffset();
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}T${dos(fecha.getHours())}:${dos(fecha.getMinutes())}:${dos(fecha.getSeconds())}.000${offset >= 0 ? '+' : '-'}${dos(offset / 60)}:${dos(offset % 60)}`;
};

/**
 * Crea el intento de pago y la preferencia de Checkout Pro. Devuelve la URL de la página de pago
 * de Mercado Pago a la que se manda al cliente.
 */
export async function crearCheckoutMercadoPago(datos: {
  id_cliente: number;
  id_usuario: number;
  id_direccion: number;
  direccion_envio: string;
  items: CartItem[];
  resumen: CartSummary;
  /** Origen con el que entró el cliente (Astro.url.origin), para regresarlo al mismo sitio. */
  origen?: string;
}): Promise<{ id: number; url: string }> {
  if (datos.items.length === 0) throw new MercadoPagoError('Tu carrito está vacío.');
  const mp = cliente();

  const articulos: ArticuloCheckout[] = datos.items.map((item) => ({
    id_producto: item.id_producto,
    cantidad: item.cantidad,
    precio: item.precio,
    titulo: `${item.nombre} (${item.variante})`.slice(0, 250),
  }));

  // Lo que se cobra en Mercado Pago debe sumar exactamente el total del carrito
  const suma = articulos.reduce((t, a) => t + aCentavos(a.precio) * a.cantidad, 0) + aCentavos(datos.resumen.envio);
  if (suma !== aCentavos(datos.resumen.total)) throw new MercadoPagoError('El total del carrito cambió. Revísalo e intenta de nuevo.', 409);

  const ahora = new Date();
  const [res] = await db.insert(CheckoutsMercadoPago).values({
    id_cliente: datos.id_cliente,
    id_usuario: datos.id_usuario,
    id_direccion: datos.id_direccion,
    direccion_envio: datos.direccion_envio,
    articulos: JSON.stringify(articulos),
    envio: datos.resumen.envio.toFixed(2),
    total: datos.resumen.total.toFixed(2),
    estado: 'pendiente',
    fecha_creacion: ahora,
    fecha_actualizacion: ahora,
  });
  const id = Number(res.insertId);

  const sitio = urlSitio(datos.origen);
  const publico = sitio.startsWith('https://');
  const regreso = `${sitio}/checkout/mercadopago`;

  try {
    const preferencia = await new Preference(mp).create({
      body: {
        items: [
          ...articulos.map((a) => ({
            id: String(a.id_producto),
            title: a.titulo,
            quantity: a.cantidad,
            unit_price: a.precio,
            currency_id: 'MXN',
          })),
          ...(datos.resumen.envio > 0
            ? [{ id: 'envio', title: 'Envío', quantity: 1, unit_price: datos.resumen.envio, currency_id: 'MXN' }]
            : []),
        ],
        external_reference: String(id),
        back_urls: { success: regreso, failure: regreso, pending: regreso },
        // Mercado Pago descarta en silencio las URLs de localhost: el regreso automático, el botón
        // "Volver al sitio" y el webhook solo funcionan con una URL pública https (SITE_URL). En local,
        // revisarPagosPendientes encuentra el pago cuando el cliente vuelve a la tienda.
        ...(publico ? { auto_return: 'approved', notification_url: `${sitio}/api/webhooks/mercadopago` } : {}),
        statement_descriptor: 'SPORTENIS',
        // La preferencia caduca para no cobrar después con precios o stock viejos
        expires: true,
        expiration_date_to: fechaConZona(new Date(ahora.getTime() + 60 * 60 * 1000)),
      },
      requestOptions: { idempotencyKey: `sportenis-checkout-${id}` },
    });

    if (!preferencia.id || !preferencia.init_point) throw new Error('Mercado Pago no devolvió la página de pago.');
    await db
      .update(CheckoutsMercadoPago)
      .set({ preference_id: preferencia.id, fecha_actualizacion: new Date() })
      .where(eq(CheckoutsMercadoPago.id, id));
    return { id, url: preferencia.init_point };
  } catch (error) {
    await db
      .update(CheckoutsMercadoPago)
      .set({ estado: 'error', mensaje: 'No se pudo crear la preferencia de pago.', fecha_actualizacion: new Date() })
      .where(eq(CheckoutsMercadoPago.id, id));
    if (error instanceof MercadoPagoError) throw error;
    console.error('Error al crear la preferencia de Mercado Pago:', error);
    throw new MercadoPagoError('No pudimos conectar con Mercado Pago. Intenta de nuevo en un momento.', 502);
  }
}

export type ResultadoPago =
  | { estado: 'pagado'; id_venta: number }
  | { estado: 'pendiente' | 'fallido' | 'reembolsado' | 'error' | 'desconocido'; mensaje: string };

const MOTIVOS_RECHAZO: Readonly<Record<string, string>> = {
  cc_rejected_insufficient_amount: 'La tarjeta no tiene fondos suficientes.',
  cc_rejected_bad_filled_security_code: 'El código de seguridad es incorrecto.',
  cc_rejected_bad_filled_date: 'La fecha de vencimiento es incorrecta.',
  cc_rejected_bad_filled_other: 'Revisa los datos de la tarjeta.',
  cc_rejected_call_for_authorize: 'Tu banco pide que autorices el pago.',
  cc_rejected_high_risk: 'Mercado Pago rechazó el pago por seguridad.',
};

const actualizar = (id: number, cambios: Partial<typeof CheckoutsMercadoPago.$inferInsert>) =>
  db.update(CheckoutsMercadoPago).set({ ...cambios, fecha_actualizacion: new Date() }).where(eq(CheckoutsMercadoPago.id, id));

async function reembolsar(paymentId: string, id: number, motivo: string): Promise<ResultadoPago> {
  try {
    await new PaymentRefund(cliente()).create({ payment_id: paymentId, requestOptions: { idempotencyKey: `sportenis-reembolso-${paymentId}` } });
    await actualizar(id, { estado: 'reembolsado', mensaje: motivo.slice(0, 255) });
    return { estado: 'reembolsado', mensaje: `${motivo} Te devolvimos el pago en Mercado Pago.` };
  } catch (error) {
    // No se pudo reembolsar solo: queda marcado para que el personal lo revise
    console.error(`No se pudo reembolsar el pago ${paymentId} de Mercado Pago:`, error);
    await actualizar(id, { estado: 'error', mensaje: `Reembolso pendiente: ${motivo}`.slice(0, 255) });
    return { estado: 'error', mensaje: `${motivo} Revisaremos tu pago y te lo devolveremos.` };
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Devuelve en Mercado Pago el pago de una venta que se está cancelando. Va dentro de la transacción
 * de la cancelación y al final de ella: si Mercado Pago no acepta el reembolso, se lanza
 * MercadoPagoError y la cancelación completa se revierte (el pedido no queda cancelado sin devolver
 * el dinero). La llave de idempotencia evita un doble reembolso si se reintenta.
 * Devuelve false si la venta no se pagó con Mercado Pago.
 */
export async function reembolsarVentaMercadoPago(tx: Tx, id_venta: number): Promise<boolean> {
  const [checkout] = await tx
    .select({ id: CheckoutsMercadoPago.id, paymentId: CheckoutsMercadoPago.payment_id, estado: CheckoutsMercadoPago.estado })
    .from(CheckoutsMercadoPago)
    .where(eq(CheckoutsMercadoPago.id_venta, id_venta))
    .limit(1);
  if (!checkout?.paymentId) return false;
  if (checkout.estado === 'reembolsado') return true;

  try {
    await new PaymentRefund(cliente()).create({
      payment_id: checkout.paymentId,
      requestOptions: { idempotencyKey: `sportenis-cancelacion-${checkout.paymentId}` },
    });
  } catch (error) {
    console.error(`No se pudo reembolsar en Mercado Pago el pago ${checkout.paymentId} (venta #${id_venta}):`, error);
    throw new MercadoPagoError(
      'Mercado Pago no aceptó el reembolso, así que la orden no se canceló. Inténtalo de nuevo en un momento o revisa el pago en tu panel de Mercado Pago.',
      502,
    );
  }

  await tx
    .update(CheckoutsMercadoPago)
    .set({ estado: 'reembolsado', mensaje: `Reembolsado al cancelar la venta #${id_venta}`, fecha_actualizacion: new Date() })
    .where(eq(CheckoutsMercadoPago.id, checkout.id));
  return true;
}

/**
 * Consulta un pago a la API de Mercado Pago y actúa según su estado. Se puede llamar varias veces con
 * el mismo pago (regreso del cliente y webhook): solo la primera que lo "reclama" registra la venta.
 */
export async function procesarPagoMercadoPago(paymentId: string): Promise<ResultadoPago> {
  if (!/^\d{1,30}$/.test(paymentId)) return { estado: 'desconocido', mensaje: 'Pago no válido.' };

  const pago = await new Payment(cliente()).get({ id: paymentId });
  const id = Number(pago.external_reference);
  const [checkout] = Number.isInteger(id) && id > 0
    ? await db.select().from(CheckoutsMercadoPago).where(eq(CheckoutsMercadoPago.id, id))
    : [];
  if (!checkout) return { estado: 'desconocido', mensaje: 'No encontramos la compra de este pago.' };

  if (checkout.estado === 'pagado' && checkout.id_venta) return { estado: 'pagado', id_venta: checkout.id_venta };
  if (checkout.estado === 'reembolsado' || checkout.estado === 'error' || checkout.estado === 'procesando') {
    return { estado: checkout.estado === 'procesando' ? 'pendiente' : checkout.estado, mensaje: checkout.mensaje ?? 'Estamos revisando tu pago.' };
  }

  if (pago.status === 'approved') {
    // Solo una solicitud a la vez puede registrar la venta de este intento de pago
    const [reclamo] = await db
      .update(CheckoutsMercadoPago)
      .set({ estado: 'procesando', payment_id: paymentId, fecha_actualizacion: new Date() })
      .where(and(eq(CheckoutsMercadoPago.id, id), inArray(CheckoutsMercadoPago.estado, ['pendiente', 'fallido'])));
    if (reclamo.affectedRows !== 1) return procesarPagoMercadoPagoGuardado(id);

    // El pago tiene que ser del monto exacto y en pesos
    if (pago.currency_id !== 'MXN' || aCentavos(pago.transaction_amount ?? 0) !== aCentavos(Number(checkout.total))) {
      return reembolsar(paymentId, id, 'El monto pagado no coincide con el de tu compra.');
    }

    try {
      const articulos = JSON.parse(checkout.articulos) as ArticuloCheckout[];
      const venta = await registrarVenta({
        id_cliente: checkout.id_cliente,
        id_usuario: checkout.id_usuario,
        id_metodo_pago: await idMetodoPago('mercado_pago'),
        // Se cobran exactamente los precios y el envío con los que se pagó en Mercado Pago
        items: articulos.map((a) => ({ id_producto: a.id_producto, cantidad: a.cantidad, precio: a.precio })),
        envio: Number(checkout.envio),
        referencia_pago: `Mercado Pago #${paymentId}`,
        id_direccion: checkout.id_direccion,
        direccion_envio: checkout.direccion_envio,
      });
      await actualizar(id, { estado: 'pagado', id_venta: venta.id_venta, mensaje: null });
      await clearCart(checkout.id_cliente);
      return { estado: 'pagado', id_venta: venta.id_venta };
    } catch (error) {
      const motivo = error instanceof Error && 'status' in error ? error.message : 'No pudimos registrar tu compra.';
      if (!(error instanceof Error && 'status' in error)) console.error('Error al registrar la venta de Mercado Pago:', error);
      return reembolsar(paymentId, id, motivo);
    }
  }

  if (pago.status === 'pending' || pago.status === 'in_process' || pago.status === 'authorized') {
    await actualizar(id, { payment_id: paymentId });
    return { estado: 'pendiente', mensaje: 'Tu pago está en proceso. Registraremos tu compra en cuanto Mercado Pago lo apruebe.' };
  }

  // Rechazado o cancelado: el cliente puede volver a intentar desde el carrito
  const mensaje = MOTIVOS_RECHAZO[pago.status_detail ?? ''] ?? 'Mercado Pago no aprobó el pago.';
  await actualizar(id, { estado: 'fallido', payment_id: paymentId, mensaje });
  return { estado: 'fallido', mensaje };
}

/**
 * Busca en Mercado Pago los pagos de los intentos pendientes del cliente (por su external_reference)
 * y procesa el que encuentre. Hace falta cuando no hubo regreso ni webhook (en localhost Mercado Pago
 * no regresa al cliente): se llama al volver al carrito, a "Mis compras" o a la página de regreso.
 */
export async function revisarPagosPendientes(id_cliente: number): Promise<ResultadoPago | null> {
  if (!mercadoPagoConfigurado()) return null;
  const desde = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const pendientes = await db
    .select({ id: CheckoutsMercadoPago.id })
    .from(CheckoutsMercadoPago)
    .where(and(
      eq(CheckoutsMercadoPago.id_cliente, id_cliente),
      inArray(CheckoutsMercadoPago.estado, ['pendiente', 'fallido']),
      gte(CheckoutsMercadoPago.fecha_creacion, desde),
    ))
    .orderBy(desc(CheckoutsMercadoPago.id))
    .limit(5);

  let resultado: ResultadoPago | null = null;
  for (const { id } of pendientes) {
    const busqueda = await new Payment(cliente()).search({
      options: { external_reference: String(id), sort: 'date_created', criteria: 'desc' },
    });
    const pagos = busqueda.results ?? [];
    // Primero un pago aprobado; si no hay, el más reciente (pendiente o rechazado) para anotar su estado
    const pago = pagos.find((p) => p.status === 'approved') ?? pagos[0];
    if (!pago?.id) continue;
    const r = await procesarPagoMercadoPago(String(pago.id));
    if (r.estado === 'pagado') return r;
    resultado ??= r;
  }
  return resultado;
}

async function procesarPagoMercadoPagoGuardado(id: number): Promise<ResultadoPago> {
  const [checkout] = await db.select().from(CheckoutsMercadoPago).where(eq(CheckoutsMercadoPago.id, id));
  if (checkout?.estado === 'pagado' && checkout.id_venta) return { estado: 'pagado', id_venta: checkout.id_venta };
  return { estado: 'pendiente', mensaje: 'Estamos registrando tu compra; actualiza la página en unos segundos.' };
}

/**
 * Valida la firma de un webhook (encabezado x-signature) con el secreto de la aplicación.
 * Plantilla de Mercado Pago: "id:{data.id};request-id:{x-request-id};ts:{ts};" firmada con HMAC-SHA256.
 */
export function firmaWebhookValida(firma: string | null, requestId: string | null, dataId: string, secreto: string): boolean {
  if (!firma) return false;
  const partes = Object.fromEntries(firma.split(',').map((p) => p.trim().split('=') as [string, string]));
  if (!partes.ts || !partes.v1) return false;
  const plantilla = `id:${dataId.toLowerCase()};${requestId ? `request-id:${requestId};` : ''}ts:${partes.ts};`;
  const esperada = createHmac('sha256', secreto).update(plantilla).digest('hex');
  const a = Buffer.from(esperada);
  const b = Buffer.from(partes.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
