import type { APIRoute } from 'astro';
import { db } from '../../../db/db';
import {
  Presupuestos, CuentasPorCobrar, CuentasPorPagar,
  Clientes, Proveedores,
} from '../../../db/schema';
import { eq } from 'drizzle-orm';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// ─── Presupuestos ──────────────────────────────────────────────────
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'No autorizado.' }, 401);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Cuerpo inválido.' }, 400); }

  const { action } = body;

  try {
    // ── Presupuestos ────────────────────
    if (action === 'crear_presupuesto') {
      const { periodo, ingresos_proyectados, egresos_proyectados, notas } = body;
      if (!periodo || ingresos_proyectados == null || egresos_proyectados == null) {
        return json({ error: 'Faltan campos requeridos.' }, 400);
      }
      const [res] = await db.insert(Presupuestos).values({
        periodo,
        ingresos_proyectados: Number(ingresos_proyectados).toFixed(2),
        egresos_proyectados: Number(egresos_proyectados).toFixed(2),
        notas: notas || null,
        fecha_creacion: new Date(),
      });
      return json({ success: true, id: Number(res.insertId) }, 201);
    }

    if (action === 'eliminar_presupuesto') {
      const { id } = body;
      if (!id) return json({ error: 'ID requerido.' }, 400);
      await db.delete(Presupuestos).where(eq(Presupuestos.id, Number(id)));
      return json({ success: true });
    }

    // ── Cuentas por Cobrar ──────────────
    if (action === 'crear_cxc') {
      const { id_cliente, id_venta, concepto, monto, fecha_vencimiento } = body;
      if (!id_cliente || !concepto || !monto || !fecha_vencimiento) {
        return json({ error: 'Faltan campos requeridos.' }, 400);
      }
      const [cliente] = await db.select({ id: Clientes.id }).from(Clientes).where(eq(Clientes.id, Number(id_cliente)));
      if (!cliente) return json({ error: 'El cliente no existe.' }, 404);

      const [res] = await db.insert(CuentasPorCobrar).values({
        id_cliente: Number(id_cliente),
        id_venta: id_venta ? Number(id_venta) : null,
        concepto,
        monto: Number(monto).toFixed(2),
        estado: 'Pendiente',
        fecha_emision: new Date(),
        fecha_vencimiento: new Date(fecha_vencimiento),
      });
      return json({ success: true, id: Number(res.insertId) }, 201);
    }

    if (action === 'cobrar_cxc') {
      const { id, monto_pago } = body;
      if (!id || !monto_pago) return json({ error: 'Faltan datos.' }, 400);

      const [cxc] = await db.select().from(CuentasPorCobrar).where(eq(CuentasPorCobrar.id, Number(id)));
      if (!cxc) return json({ error: 'Cuenta no encontrada.' }, 404);

      const nuevoPagado = Number(cxc.monto_pagado) + Number(monto_pago);
      const montoTotal = Number(cxc.monto);
      const pagado = nuevoPagado >= montoTotal;

      await db.update(CuentasPorCobrar).set({
        monto_pagado: Math.min(nuevoPagado, montoTotal).toFixed(2),
        estado: pagado ? 'Cobrada' : 'Parcial',
        fecha_pago: pagado ? new Date() : null,
      }).where(eq(CuentasPorCobrar.id, Number(id)));

      return json({ success: true, estado: pagado ? 'Cobrada' : 'Parcial' });
    }

    // ── Cuentas por Pagar ───────────────
    if (action === 'crear_cxp') {
      const { id_proveedor, id_pedido_compra, concepto, monto, fecha_vencimiento } = body;
      if (!id_proveedor || !concepto || !monto || !fecha_vencimiento) {
        return json({ error: 'Faltan campos requeridos.' }, 400);
      }
      const [prov] = await db.select({ id: Proveedores.id }).from(Proveedores).where(eq(Proveedores.id, Number(id_proveedor)));
      if (!prov) return json({ error: 'El proveedor no existe.' }, 404);

      const [res] = await db.insert(CuentasPorPagar).values({
        id_proveedor: Number(id_proveedor),
        id_pedido_compra: id_pedido_compra ? Number(id_pedido_compra) : null,
        concepto,
        monto: Number(monto).toFixed(2),
        estado: 'Pendiente',
        fecha_emision: new Date(),
        fecha_vencimiento: new Date(fecha_vencimiento),
      });
      return json({ success: true, id: Number(res.insertId) }, 201);
    }

    if (action === 'pagar_cxp') {
      const { id, monto_pago } = body;
      if (!id || !monto_pago) return json({ error: 'Faltan datos.' }, 400);

      const [cxp] = await db.select().from(CuentasPorPagar).where(eq(CuentasPorPagar.id, Number(id)));
      if (!cxp) return json({ error: 'Cuenta no encontrada.' }, 404);

      const nuevoPagado = Number(cxp.monto_pagado) + Number(monto_pago);
      const montoTotal = Number(cxp.monto);
      const pagado = nuevoPagado >= montoTotal;

      await db.update(CuentasPorPagar).set({
        monto_pagado: Math.min(nuevoPagado, montoTotal).toFixed(2),
        estado: pagado ? 'Pagada' : 'Parcial',
        fecha_pago: pagado ? new Date() : null,
      }).where(eq(CuentasPorPagar.id, Number(id)));

      return json({ success: true, estado: pagado ? 'Pagada' : 'Parcial' });
    }

    return json({ error: 'Acción no reconocida.' }, 400);
  } catch (err: any) {
    console.error('Error en API presupuestos:', err);
    return json({ error: err?.message || 'Error interno.' }, 500);
  }
};
