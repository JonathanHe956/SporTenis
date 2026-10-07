import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { Clientes, DetalleVentas, MetodosPago, Productos, Ventas } from '../db/schema';
import { procesarLogisticaStock } from './stockLogistics';

// Regla de envío de la tienda: gratis a partir de ENVIO_GRATIS_DESDE
export const ENVIO_GRATIS_DESDE = 999;
export const COSTO_ENVIO = 99;

/** Error de negocio cuyo mensaje sí se puede mostrar al usuario. */
export class VentaError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'VentaError';
    this.status = status;
  }
}

export interface ItemVenta {
  id_producto: number;
  cantidad: number;
  /** Precio unitario fijado por el personal; si se omite se usa el precio de catálogo. */
  precio?: number;
}

export interface TotalesVenta {
  subtotal: number;
  envio: number;
  total: number;
}

const toCents = (value: number): number => Math.round(value * 100);

export const calcularEnvio = (subtotal: number): number =>
  subtotal <= 0 || subtotal >= ENVIO_GRATIS_DESDE ? 0 : COSTO_ENVIO;

// Se suma en centavos para no arrastrar errores de punto flotante.
export const calcularSubtotal = (lineas: Array<{ precio: number; cantidad: number }>): number =>
  lineas.reduce((cents, linea) => cents + toCents(linea.precio) * linea.cantidad, 0) / 100;

export const calcularTotales = (
  lineas: Array<{ precio: number; cantidad: number }>,
  envio?: number,
): TotalesVenta => {
  const subtotal = calcularSubtotal(lineas);
  const envioFinal = envio ?? calcularEnvio(subtotal);
  return {
    subtotal,
    envio: envioFinal,
    total: (toCents(subtotal) + toCents(envioFinal)) / 100,
  };
};

export const normalizarItems = (detalles: unknown): ItemVenta[] => {
  if (!Array.isArray(detalles) || detalles.length === 0) {
    throw new VentaError('Debes incluir al menos un producto.');
  }

  return detalles.map((det) => {
    const id_producto = Number(det?.id_producto);
    const cantidad = Number(det?.cantidad);
    if (!Number.isInteger(id_producto) || id_producto <= 0 || !Number.isInteger(cantidad) || cantidad <= 0) {
      throw new VentaError('Detalles de producto inválidos. Se requiere id_producto y cantidad > 0.');
    }

    if (det.precio === undefined || det.precio === null) return { id_producto, cantidad };

    const precio = Number(det.precio);
    if (!Number.isFinite(precio) || precio < 0) {
      throw new VentaError('Precio unitario inválido.');
    }
    return { id_producto, cantidad, precio };
  });
};

export interface NuevaVenta {
  id_cliente: number;
  id_usuario: number | null;
  id_metodo_pago: number;
  items: ItemVenta[];
  /** Si se omite se aplica la regla de envío de la tienda. */
  envio?: number;
  cupon_descuento?: string | null;
}

/**
 * Registra la venta, sus detalles y el descuento de stock en una sola transacción.
 * El stock se descuenta con `WHERE stock >= cantidad`, así dos ventas simultáneas
 * no pueden vender la misma unidad ni dejar el inventario en negativo.
 */
export async function registrarVenta(venta: NuevaVenta): Promise<TotalesVenta & { id_venta: number }> {
  const items = normalizarItems(venta.items);

  if (venta.envio !== undefined && (!Number.isFinite(venta.envio) || venta.envio < 0)) {
    throw new VentaError('Costo de envío inválido.');
  }

  const cliente = await db.select({ id: Clientes.id }).from(Clientes).where(eq(Clientes.id, venta.id_cliente));
  if (!cliente[0]) throw new VentaError('El cliente seleccionado no existe.');

  const metodo = await db.select({ id: MetodosPago.id }).from(MetodosPago).where(eq(MetodosPago.id, venta.id_metodo_pago));
  if (!metodo[0]) throw new VentaError('El método de pago seleccionado no existe.');

  const resultado = await db.transaction(async (tx) => {
    const lineas: Array<{ id_producto: number; cantidad: number; precio: number }> = [];

    for (const item of items) {
      const producto = await tx
        .select({ precio_venta: Productos.precio_venta, stock: Productos.stock, sku: Productos.sku })
        .from(Productos)
        .where(eq(Productos.id, item.id_producto));

      if (!producto[0]) {
        throw new VentaError(`El producto ID ${item.id_producto} no existe en el catálogo.`, 404);
      }

      const [descuento] = await tx
        .update(Productos)
        .set({ stock: sql`${Productos.stock} - ${item.cantidad}` })
        .where(and(eq(Productos.id, item.id_producto), gte(Productos.stock, item.cantidad)));

      if (descuento.affectedRows !== 1) {
        throw new VentaError(
          `Stock insuficiente para SKU ${producto[0].sku}. Disponible: ${producto[0].stock}, Solicitado: ${item.cantidad}.`,
          409,
        );
      }

      lineas.push({
        id_producto: item.id_producto,
        cantidad: item.cantidad,
        precio: item.precio ?? Number(producto[0].precio_venta),
      });
    }

    const totales = calcularTotales(lineas, venta.envio);

    const [resVenta] = await tx.insert(Ventas).values({
      id_cliente: venta.id_cliente,
      id_usuario: venta.id_usuario,
      id_metodo_pago: venta.id_metodo_pago,
      fecha_venta: new Date(),
      subtotal: totales.subtotal.toFixed(2),
      envio: totales.envio.toFixed(2),
      total: totales.total.toFixed(2),
      cupon_descuento: venta.cupon_descuento || null,
    });

    const id_venta = Number(resVenta.insertId);

    await tx.insert(DetalleVentas).values(
      lineas.map((linea) => ({
        id_venta,
        id_producto: linea.id_producto,
        cantidad: linea.cantidad,
        precio_unitario: linea.precio.toFixed(2),
        subtotal: calcularSubtotal([linea]).toFixed(2),
      })),
    );

    return { id_venta, ...totales };
  });

  // Procesar reposición PUSH automática o alerta PULL para cada producto vendido
  for (const id_producto of new Set(items.map((item) => item.id_producto))) {
    await procesarLogisticaStock({ id_producto, id_usuario: venta.id_usuario ?? undefined });
  }

  return resultado;
}
