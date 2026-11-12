import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db } from '../../../db/db';
import { MetodosPago, Pagos, Ventas } from '../../../db/schema';
import { canAccessCrm, canAccessErp } from '../../../lib/auth';
import { findClientId } from '../../../lib/clientes';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// GET /api/pagos/{id} → un pago con su pedido. El cliente solo ve los suyos; CRM y ERP ven todos.
export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ ok: false, error: 'Debes iniciar sesión.' }, 401);

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: 'Pago inválido.' }, 400);

  const [pago] = await db
    .select({
      id: Pagos.id,
      pedido_id: Pagos.id_venta,
      monto: Pagos.monto,
      metodo_pago: MetodosPago.nombre,
      estado: Pagos.estado,
      fecha: Pagos.fecha_pago,
      referencia: Pagos.referencia,
      id_cliente: Ventas.id_cliente,
      estado_pedido: Ventas.estado,
    })
    .from(Pagos)
    .innerJoin(Ventas, eq(Ventas.id, Pagos.id_venta))
    .innerJoin(MetodosPago, eq(MetodosPago.id, Pagos.id_metodo_pago))
    .where(eq(Pagos.id, id));

  // Un pago ajeno responde igual que uno inexistente, para no revelar qué ids existen
  const esPersonal = canAccessCrm(user.role) || canAccessErp(user.role);
  if (!pago || (!esPersonal && pago.id_cliente !== (await findClientId(user.id)))) {
    return json({ ok: false, error: 'Pago no encontrado.' }, 404);
  }

  const { id_cliente, ...datos } = pago;
  return json({ ok: true, pago: { ...datos, monto: Number(datos.monto), ...(esPersonal ? { id_cliente } : {}) } });
};
