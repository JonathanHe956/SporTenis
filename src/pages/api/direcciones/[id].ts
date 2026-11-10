import type { APIRoute } from 'astro';
import { findClientId } from '../../../lib/clientes';
import {
  DireccionError,
  actualizarDireccion,
  eliminarDireccion,
  listarDirecciones,
  marcarPrincipal,
  validarDireccionConCatalogo,
} from '../../../lib/direcciones';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Cliente del usuario y id de la dirección; cada operación revisa que la dirección sea suya. */
type Contexto = { error: Response } | { clientId: number; id: number };

const contexto = async (locals: App.Locals, idParam: string | undefined): Promise<Contexto> => {
  if (!locals.user) return { error: json({ ok: false, error: 'Debes iniciar sesión.' }, 401) };
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return { error: json({ ok: false, error: 'Dirección inválida.' }, 400) };
  const clientId = await findClientId(locals.user.id);
  if (!clientId) return { error: json({ ok: false, error: 'Dirección no encontrada.' }, 404) };
  return { clientId, id };
};

const fallo = (error: unknown, accion: string): Response => {
  if (error instanceof DireccionError) return json({ ok: false, error: error.message }, error.status);
  console.error(`Error al ${accion} la dirección:`, error);
  return json({ ok: false, error: `Error interno al ${accion} la dirección.` }, 500);
};

// PUT /api/direcciones/{id} → edita la dirección; con solo `{ principal: true }` la marca como principal
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const ctx = await contexto(locals, params.id);
  if ('error' in ctx) return ctx.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  try {
    const soloPrincipal = body.principal === true && Object.keys(body).length === 1;
    if (!soloPrincipal) await actualizarDireccion(ctx.clientId, ctx.id, await validarDireccionConCatalogo(body));
    if (body.principal === true) await marcarPrincipal(ctx.clientId, ctx.id);
    return json({ ok: true, direcciones: await listarDirecciones(ctx.clientId) });
  } catch (error: unknown) {
    return fallo(error, 'actualizar');
  }
};

// DELETE /api/direcciones/{id} → los pedidos que la usaron conservan su copia de la dirección
export const DELETE: APIRoute = async ({ params, locals }) => {
  const ctx = await contexto(locals, params.id);
  if ('error' in ctx) return ctx.error;

  try {
    await eliminarDireccion(ctx.clientId, ctx.id);
    return json({ ok: true, direcciones: await listarDirecciones(ctx.clientId) });
  } catch (error: unknown) {
    return fallo(error, 'eliminar');
  }
};
