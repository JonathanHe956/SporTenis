// POST /api/chat-soporte
// Chat de IA para soporte: lee las compras del cliente de la BD y responde con Gemini.
import type { APIRoute } from 'astro';
import { findClientId } from '../../lib/clientes';
import { getComprasCliente } from '../../lib/compras';
import { db } from '../../db/db';
import { Usuarios } from '../../db/schema';
import { eq } from 'drizzle-orm';

const GEMINI_API_KEY = import.meta.env.GEMINI_API_KEY;
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';

// Número máximo de mensajes del historial que mandamos a Gemini
const MAX_HISTORY = 10;

type Rol = 'user' | 'model';
interface Mensaje { role: Rol; text: string }

export const POST: APIRoute = async ({ request, locals }) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const sessionUser = locals.user;
  if (!sessionUser) {
    return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401 });
  }

  // ── Body ──────────────────────────────────────────────────────────────────
  let body: { message?: string; history?: Mensaje[] };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 });
  }

  const userMessage = body.message?.trim();
  if (!userMessage || userMessage.length > 1000) {
    return new Response(JSON.stringify({ error: 'Mensaje vacío o demasiado largo' }), { status: 400 });
  }

  // ── Datos del cliente ─────────────────────────────────────────────────────
  const [clientId, userRow] = await Promise.all([
    findClientId(sessionUser.id),
    db.select({ nombre: Usuarios.nombre }).from(Usuarios).where(eq(Usuarios.id, sessionUser.id)).limit(1),
  ]);

  const nombre = userRow[0]?.nombre?.split(' ')[0] ?? 'Cliente';

  const fmtFecha = (d: Date) =>
    new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d));
  const fmtMXN = (n: number) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);

  let resumenCompras = 'El cliente no tiene compras registradas.';
  if (clientId !== null) {
    const compras = await getComprasCliente(clientId);
    if (compras.length > 0) {
      resumenCompras =
        `El cliente tiene ${compras.length} pedido(s):\n` +
        compras
          .map((c) => {
            const productos = c.vistaPrevia.map((p) => p.nombre).join(', ');
            const extra = c.productosExtra > 0 ? ` (+${c.productosExtra} más)` : '';
            const entrega = c.fechaEntrega ? ` | Entregado el ${fmtFecha(c.fechaEntrega)}` : '';
            return (
              `- Pedido #${c.id}` +
              (c.folio ? ` (${c.folio})` : '') +
              ` | Fecha: ${fmtFecha(c.fecha)}` +
              ` | Total: ${fmtMXN(c.total)}` +
              ` | Estado: ${c.estado}${entrega}` +
              ` | Productos: ${productos}${extra}` +
              ` | Unidades: ${c.unidades}`
            );
          })
          .join('\n');
    }
  }

  // ── System prompt ─────────────────────────────────────────────────────────
  const systemPrompt = `Eres el asistente de soporte de SporTenis, una tienda en línea de tenis y artículos deportivos. Eres amable, conciso y útil.

DATOS DEL CLIENTE:
Nombre: ${nombre}
${resumenCompras}

INSTRUCCIONES:
- Responde siempre en español, de forma clara y amigable.
- Si te preguntan por el estado de un pedido, búscalo en los datos anteriores y responde con el estado actual.
- Si te preguntan si un pedido llegó, usa la fecha de entrega y el estado "Entregada".
- Si un pedido está en "Procesando" significa que se está preparando; "Confirmada" que ya fue confirmado y está en camino.
- Puedes ayudar con dudas sobre devoluciones, cancelaciones, envío y facturación, pero para acciones concretas (cancelar, devolver) diles que abran un ticket en esta misma página.
- No inventes información. Si no sabes algo, dilo y sugiere abrir un ticket.
- Respuestas cortas (máximo 3 párrafos).`;

  // ── Historial ──────────────────────────────────────────────────────────────
  const history: Mensaje[] = Array.isArray(body.history)
    ? body.history.slice(-MAX_HISTORY).filter(
        (m): m is Mensaje =>
          (m.role === 'user' || m.role === 'model') && typeof m.text === 'string'
      )
    : [];

  // ── Llamada a Gemini ───────────────────────────────────────────────────────
  if (!GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'El chat de IA no está configurado. Falta GEMINI_API_KEY en el entorno.' }),
      { status: 503 }
    );
  }

  const contents = [
    ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  let geminiReply = '';
  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[chat-soporte] Gemini error:', err);
      return new Response(JSON.stringify({ error: 'Error al contactar la IA. Intenta de nuevo.' }), { status: 502 });
    }

    const data = await res.json() as {
      candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    geminiReply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No obtuve respuesta de la IA.';
  } catch (e) {
    console.error('[chat-soporte] fetch error:', e);
    return new Response(JSON.stringify({ error: 'Error de red al contactar la IA.' }), { status: 502 });
  }

  return new Response(JSON.stringify({ reply: geminiReply }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

