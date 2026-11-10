import type { APIRoute } from 'astro';
import { db } from '../../db/db';
import { Notificaciones } from '../../db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { accionNotificacion, filtroNotificacionesPorRol } from '../../lib/notificaciones';

// Cada rol ve solo las notificaciones que puede atender (los tickets, solo quien entra al CRM)
export const GET: APIRoute = async ({ locals }) => {
  try {
    const filas = await db
      .select()
      .from(Notificaciones)
      .where(and(eq(Notificaciones.leida, false), filtroNotificacionesPorRol(locals.user?.role)))
      .orderBy(desc(Notificaciones.fecha_creacion))
      .limit(20);
    const notificaciones = filas.map((n) => ({ ...n, accion: accionNotificacion(n) }));

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

export const POST: APIRoute = async ({ request, locals }) => {
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
      await db
        .update(Notificaciones)
        .set({ leida: true })
        .where(and(eq(Notificaciones.leida, false), filtroNotificacionesPorRol(locals.user?.role)));
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
