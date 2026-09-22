import type { APIRoute } from 'astro';
import { db } from '../../db/db';
import { Notificaciones } from '../../db/schema';
import { eq, desc } from 'drizzle-orm';

export const GET: APIRoute = async () => {
  try {
    const notificaciones = await db
      .select()
      .from(Notificaciones)
      .where(eq(Notificaciones.leida, false))
      .orderBy(desc(Notificaciones.fecha_creacion))
      .limit(20);

    return new Response(JSON.stringify({ ok: true, notificaciones }), {
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

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const action = body.action;

    if (action === 'marcar_leida') {
      const id = Number(body.id);
      await db.update(Notificaciones).set({ leida: true }).where(eq(Notificaciones.id, id));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'marcar_todas') {
      await db.update(Notificaciones).set({ leida: true }).where(eq(Notificaciones.leida, false));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: 'Acción no válida' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
