import type { APIRoute } from 'astro';
import { db } from '../../db/db';
import { ActividadTienda } from '../../db/schema';

function generateSessionId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const data = await request.json();
    const { accion, detalles } = data;

    if (!accion) {
      return new Response(JSON.stringify({ error: 'Acción es requerida' }), { status: 400 });
    }

    // Identificar usuario
    const session = cookies.get('sportenis_session');
    const id_usuario = session ? Number(session.value) : null;

    // Identificar sesión anónima
    let session_id = cookies.get('sportenis_guest_session')?.value;
    if (!session_id && !id_usuario) {
      session_id = generateSessionId();
      cookies.set('sportenis_guest_session', session_id, {
        path: '/',
        maxAge: 60 * 60 * 24 * 30 // 30 días
      });
    }

    await db.insert(ActividadTienda).values({
      session_id: id_usuario ? null : session_id,
      id_usuario: id_usuario || null,
      accion,
      detalles: detalles ? JSON.stringify(detalles) : null,
      fecha_hora: new Date()
    });

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error('Error tracking activity:', error);
    return new Response(JSON.stringify({ error: 'Error interno' }), { status: 500 });
  }
};
