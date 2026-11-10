import type { APIRoute } from 'astro';
import { ESTADOS_MX } from '../../../lib/direcciones';
import { GeoError, listarMunicipios } from '../../../lib/geo';

const json = (body: unknown, status = 200, cache = false): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // El catálogo cambia muy poco: el navegador puede guardar la lista un día
      ...(cache ? { 'Cache-Control': 'public, max-age=86400' } : {}),
    },
  });

// GET /api/geo/municipios?estado=Aguascalientes → municipios del estado, en orden alfabético
export const GET: APIRoute = async ({ url }) => {
  const estado = url.searchParams.get('estado') ?? '';
  if (!ESTADOS_MX.includes(estado as (typeof ESTADOS_MX)[number])) return json({ ok: false, error: 'Estado no válido.' }, 400);

  try {
    return json({ ok: true, estado, municipios: await listarMunicipios(estado) }, 200, true);
  } catch (error) {
    if (error instanceof GeoError) return json({ ok: false, error: error.message }, error.status);
    console.error('Error al listar municipios:', error);
    return json({ ok: false, error: 'No se pudieron cargar los municipios.' }, 500);
  }
};
