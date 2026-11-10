import type { APIRoute } from 'astro';
import { firmaWebhookValida, mercadoPagoConfigurado, procesarPagoMercadoPago } from '../../../lib/mercadoPago';

// POST /api/webhooks/mercadopago → avisos de Mercado Pago sobre pagos (tipo "payment").
// Aunque alguien enviara un aviso falso no pasaría nada: el pago siempre se vuelve a consultar
// a la API de Mercado Pago antes de registrar la venta. Con MP_WEBHOOK_SECRET además se valida la firma.
export const POST: APIRoute = async ({ request, url }) => {
  if (!mercadoPagoConfigurado()) return new Response(null, { status: 503 });

  let body: { type?: string; action?: string; data?: { id?: string | number } } = {};
  try {
    body = await request.json();
  } catch {
    // Algunos avisos llegan solo con parámetros en la URL
  }

  const tipo = body.type ?? url.searchParams.get('type') ?? url.searchParams.get('topic');
  const dataId = String(url.searchParams.get('data.id') ?? body.data?.id ?? url.searchParams.get('id') ?? '');
  if (tipo !== 'payment' || !dataId) return new Response(null, { status: 200 }); // otros avisos no interesan

  const secreto = process.env.MP_WEBHOOK_SECRET?.trim();
  if (secreto && !firmaWebhookValida(request.headers.get('x-signature'), request.headers.get('x-request-id'), dataId, secreto)) {
    return new Response(null, { status: 401 });
  }

  try {
    await procesarPagoMercadoPago(dataId);
    return new Response(null, { status: 200 });
  } catch (error) {
    // Con un error Mercado Pago reintenta el aviso más tarde
    console.error(`Error al procesar el aviso del pago ${dataId} de Mercado Pago:`, error);
    return new Response(null, { status: 500 });
  }
};
