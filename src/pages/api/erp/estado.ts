import type { APIRoute } from 'astro';
import { db } from '../../../db/db';
import { ErpSettings } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { canAccessErp } from '../../../lib/auth';

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * GET /api/erp/estado
 * Devuelve el nivel ERP actual (singleton row).
 */
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user || !canAccessErp(user.role)) {
    return json({ ok: false, error: 'No autorizado.' }, 403);
  }

  try {
    const rows = await db.select().from(ErpSettings);
    const nivel_erp = rows.length > 0 ? rows[0].nivel_erp : 'Inicial';
    return json({ ok: true, nivel_erp }, 200);
  } catch (error: any) {
    return json({ ok: false, error: error.message }, 500);
  }
};

/**
 * PUT /api/erp/estado
 * Actualiza el nivel ERP (upsert en la tabla singleton).
 * Body esperado: { "nivel_erp": "Intermedio" }
 */
export const PUT: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user || !canAccessErp(user.role)) {
    return json({ ok: false, error: 'No autorizado.' }, 403);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Cuerpo de solicitud inválido.' }, 400);
  }

  const { nivel_erp } = body;
  if (!nivel_erp || typeof nivel_erp !== 'string') {
    return json({ ok: false, error: 'El campo nivel_erp es requerido.' }, 400);
  }

  try {
    const existing = await db.select().from(ErpSettings);
    if (existing.length > 0) {
      await db
        .update(ErpSettings)
        .set({ nivel_erp, fecha_actualizacion: new Date() })
        .where(eq(ErpSettings.id, existing[0].id));
    } else {
      await db
        .insert(ErpSettings)
        .values({ nivel_erp, fecha_actualizacion: new Date() });
    }

    return json({ ok: true, nivel_erp }, 200);
  } catch (error: any) {
    return json({ ok: false, error: error.message }, 500);
  }
};
