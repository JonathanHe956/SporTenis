import type { APIRoute } from 'astro';
import { procesarLogisticaStock } from '../../lib/stockLogistics';

export const GET: APIRoute = async () => {
  try {
    const resultado = await procesarLogisticaStock();
    return new Response(JSON.stringify(resultado), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
