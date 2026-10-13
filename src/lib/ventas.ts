import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { Clientes, DetalleVentas, HistorialOrdenes, MetodosPago, MovimientosInventario, Productos, Ventas } from '../db/schema';
import { facturarYConciliarVenta } from './facturacion';
import { procesarLogisticaStock } from './stockLogistics';

// Regla de envío de la tienda: se cobra COSTO_ENVIO mientras la compra no supere ENVIO_GRATIS_SOBRE
export const ENVIO_GRATIS_SOBRE = 2000;
export const COSTO_ENVIO = 500;

// Solo estas órdenes cuentan como venta e ingreso: ya descontaron stock.
// Procesando todavía se puede modificar y Cancelada devolvió el inventario.
export const ESTADOS_VENTA_EFECTIVA = ['Confirmada', 'Entregada'];

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
  subtotal <= 0 || subtotal > ENVIO_GRATIS_SOBRE ? 0 : COSTO_ENVIO;

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
  /**
   * 'Confirmada' (por defecto) descuenta el stock al registrar.
   * 'Procesando' deja la orden editable y el stock se descuenta al confirmarla en /erp/ordenes.
   */
  estado?: 'Procesando' | 'Confirmada';
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Deja en el historial quién movió la orden de estado; va dentro de la transacción del cambio. */
export const registrarHistorialOrden = (
  tx: Tx,
  cambio: { id_venta: number; id_usuario: number | null; estado_anterior: string | null; estado_nuevo: string },
) => tx.insert(HistorialOrdenes).values({ ...cambio, fecha: new Date() });
type LineaVenta = { id_producto: number; cantidad: number; precio: number };

const validarEncabezado = async (venta: { id_cliente: number; id_metodo_pago: number; envio?: number }) => {
  if (venta.envio !== undefined && (!Number.isFinite(venta.envio) || venta.envio < 0)) {
    throw new VentaError('Costo de envío inválido.');
  }

  const cliente = await db.select({ id: Clientes.id }).from(Clientes).where(eq(Clientes.id, venta.id_cliente));
  if (!cliente[0]) throw new VentaError('El cliente seleccionado no existe.');

  const metodo = await db.select({ id: MetodosPago.id }).from(MetodosPago).where(eq(MetodosPago.id, venta.id_metodo_pago));
  if (!metodo[0]) throw new VentaError('El método de pago seleccionado no existe.');
};

/**
 * Arma las líneas de una orden en Procesando: rechaza cantidades mayores al stock
 * disponible, pero no lo aparta (el descuento ocurre al confirmar la orden).
 */
async function lineasConStockDisponible(tx: Tx, items: ItemVenta[]): Promise<LineaVenta[]> {
  const solicitado = new Map<number, number>();
  const lineas: LineaVenta[] = [];

  for (const item of items) {
    const [producto] = await tx
      .select({ precio_venta: Productos.precio_venta, stock: Productos.stock, sku: Productos.sku })
      .from(Productos)
      .where(eq(Productos.id, item.id_producto));

    if (!producto) {
      throw new VentaError(`El producto ID ${item.id_producto} no existe en el catálogo.`, 404);
    }

    // El mismo producto puede venir en varias líneas: se valida la suma
    const cantidad = (solicitado.get(item.id_producto) ?? 0) + item.cantidad;
    solicitado.set(item.id_producto, cantidad);
    if (cantidad > producto.stock) {
      throw new VentaError(
        `Stock insuficiente para SKU ${producto.sku}. Disponible: ${producto.stock}, Solicitado: ${cantidad}.`,
        409,
      );
    }

    lineas.push({
      id_producto: item.id_producto,
      cantidad: item.cantidad,
      precio: item.precio ?? Number(producto.precio_venta),
    });
  }

  return lineas;
}

const detallesDeVenta = (id_venta: number, lineas: LineaVenta[]) =>
  lineas.map((linea) => ({
    id_venta,
    id_producto: linea.id_producto,
    cantidad: linea.cantidad,
    precio_unitario: linea.precio.toFixed(2),
    subtotal: calcularSubtotal([linea]).toFixed(2),
  }));

/**
 * Registra la venta, sus detalles, el descuento de stock y la salida de inventario
 * en una sola transacción.
 * El stock se descuenta con `WHERE stock >= cantidad`, así dos ventas simultáneas
 * no pueden vender la misma unidad ni dejar el inventario en negativo.
 * Con `estado: 'Procesando'` solo se valida la disponibilidad y no se toca el inventario.
 */
export async function registrarVenta(venta: NuevaVenta): Promise<TotalesVenta & { id_venta: number }> {
  const items = normalizarItems(venta.items);
  const estado = venta.estado ?? 'Confirmada';
  const confirmada = estado === 'Confirmada';

  await validarEncabezado(venta);

  const resultado = await db.transaction(async (tx) => {
    const lineas: LineaVenta[] = confirmada ? [] : await lineasConStockDisponible(tx, items);

    for (const item of confirmada ? items : []) {
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
      estado,
    });

    const id_venta = Number(resVenta.insertId);

    await tx.insert(DetalleVentas).values(detallesDeVenta(id_venta, lineas));
    await registrarHistorialOrden(tx, {
      id_venta,
      id_usuario: venta.id_usuario,
      estado_anterior: null,
      estado_nuevo: estado,
    });

    if (!confirmada) return { id_venta, ...totales };

    // La salida queda en el historial de altas y bajas de /scm/pedidos
    await tx.insert(MovimientosInventario).values(
      lineas.map((linea) => ({
        id_producto: linea.id_producto,
        tipo: 'Salida',
        cantidad: linea.cantidad,
        motivo: `Venta #${id_venta}`,
        fecha: new Date(),
        id_usuario: venta.id_usuario,
        id_venta,
      })),
    );

    // La factura y el cobro conciliado nacen con la confirmación, sin captura adicional
    await facturarYConciliarVenta(tx, { id_venta, id_metodo_pago: venta.id_metodo_pago, total: totales.total });

    return { id_venta, ...totales };
  });

  // Procesar reposición PUSH automática o alerta PULL para cada producto vendido
  for (const id_producto of confirmada ? new Set(items.map((item) => item.id_producto)) : []) {
    await procesarLogisticaStock({ id_producto, id_usuario: venta.id_usuario ?? undefined });
  }

  return resultado;
}

export interface CambiosOrden {
  id_venta: number;
  id_cliente: number;
  id_metodo_pago: number;
  items: ItemVenta[];
  envio?: number;
  cupon_descuento?: string | null;
}

/**
 * Modifica una orden que sigue en Procesando: reemplaza sus artículos y recalcula los totales.
 * No toca el inventario; una orden confirmada, entregada o cancelada ya no se puede modificar.
 */
export async function actualizarOrden(orden: CambiosOrden): Promise<TotalesVenta & { id_venta: number }> {
  const items = normalizarItems(orden.items);

  if (!Number.isSafeInteger(orden.id_venta) || orden.id_venta <= 0) {
    throw new VentaError('La orden seleccionada no es válida.');
  }

  await validarEncabezado(orden);

  return db.transaction(async (tx) => {
    // El bloqueo evita que la orden se confirme a la mitad de la modificación
    const [actual] = await tx
      .select({ estado: Ventas.estado })
      .from(Ventas)
      .where(eq(Ventas.id, orden.id_venta))
      .for('update');

    if (!actual) throw new VentaError('No se encontró la orden solicitada.', 404);
    if (actual.estado !== 'Procesando') {
      throw new VentaError(`La orden ya está ${actual.estado.toLowerCase()} y no se puede modificar.`, 409);
    }

    const lineas = await lineasConStockDisponible(tx, items);
    const totales = calcularTotales(lineas, orden.envio);

    await tx
      .update(Ventas)
      .set({
        id_cliente: orden.id_cliente,
        id_metodo_pago: orden.id_metodo_pago,
        subtotal: totales.subtotal.toFixed(2),
        envio: totales.envio.toFixed(2),
        total: totales.total.toFixed(2),
        cupon_descuento: orden.cupon_descuento || null,
      })
      .where(eq(Ventas.id, orden.id_venta));

    await tx.delete(DetalleVentas).where(eq(DetalleVentas.id_venta, orden.id_venta));
    await tx.insert(DetalleVentas).values(detallesDeVenta(orden.id_venta, lineas));

    return { id_venta: orden.id_venta, ...totales };
  });
}
