import type { APIRoute } from 'astro';
import { GeoError, buscarCodigoPostal } from '../../../../lib/geo';

const json = (body: unknown, status = 200, cache = false): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(cache ? { 'Cache-Control': 'public, max-age=86400' } : {}),
    },
  });

// GET /api/geo/cp/20298 → estado, municipio y colonias de ese código postal
export const GET: APIRoute = async ({ params }) => {
  try {
    const resultado = await buscarCodigoPostal(params.cp ?? '');
    if (!resultado) return json({ ok: false, error: 'No encontramos ese código postal. Revísalo.' }, 404);
    return json({ ok: true, ...resultado }, 200, true);
  } catch (error) {
    if (error instanceof GeoError) return json({ ok: false, error: error.message }, error.status);
    console.error('Error al buscar el código postal:', error);
    return json({ ok: false, error: 'No se pudo consultar el código postal.' }, 500);
  }
};
