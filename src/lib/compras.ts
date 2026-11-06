// Consultas de solo lectura para "Mis compras": historial del cliente y detalle de cada pedido.
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/db';
import {
  Categorias,
  DetalleVentas,
  Facturas,
  HistorialOrdenes,
  MetodosPago,
  Modelos,
  Pagos,
  Productos,
  Ventas,
} from '../db/schema';
import { desglosarIva } from './facturacion';

export interface CompraResumen {
  id: number;
  folio: string | null;
  fecha: Date;
  total: number;
  estado: string;
  unidades: number;
  /** Hasta 3 productos para la vista previa de la tarjeta. */
  vistaPrevia: Array<{ nombre: string; imagen: string | null; tema: string | null }>;
  productosExtra: number;
}

export interface ArticuloCompra {
  id_producto: number;
  sku: string;
  nombre: string;
  categoria: string | null;
  variante: string;
  imagen: string | null;
  tema: string | null;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface CompraDetalle {
  id: number;
  fecha: Date;
  estado: string;
  fechaEntrega: Date | null;
  cupon: string | null;
  metodoPago: string;
  subtotal: number;
  envio: number;
  total: number;
  /** Desglose de IVA: de la factura si existe; si no, calculado del total. */
  baseSinIva: number;
  iva: number;
  articulos: ArticuloCompra[];
  pago: { estado: string; monto: number; fecha: Date } | null;
  factura: { folio: string; uuid: string; estado: string; fechaEmision: Date } | null;
  historial: Array<{ estado: string; fecha: Date }>;
}

const variante = (color: string | null, talla: string | null): string =>
  [color, talla ? `${talla}cm` : ''].filter(Boolean).join(' - ') || 'Estándar';

/** Pedidos del cliente, del más reciente al más antiguo. */
export async function getComprasCliente(clientId: number): Promise<CompraResumen[]> {
  const ventas = await db
    .select({ id: Ventas.id, fecha: Ventas.fecha_venta, total: Ventas.total, estado: Ventas.estado })
    .from(Ventas)
    .where(eq(Ventas.id_cliente, clientId))
    .orderBy(desc(Ventas.fecha_venta), desc(Ventas.id));

  if (ventas.length === 0) return [];
  const ids = ventas.map((v) => v.id);

  const [facturas, detalles] = await Promise.all([
    db.select({ id_venta: Facturas.id_venta, folio: Facturas.folio }).from(Facturas).where(inArray(Facturas.id_venta, ids)),
    db
      .select({
        id_venta: DetalleVentas.id_venta,
        cantidad: DetalleVentas.cantidad,
        nombre: Modelos.nombre,
        imagen: Modelos.imagen_url,
        tema: Productos.theme_class,
      })
      .from(DetalleVentas)
      .innerJoin(Productos, eq(DetalleVentas.id_producto, Productos.id))
      .innerJoin(Modelos, eq(Productos.id_modelo, Modelos.id))
      .where(inArray(DetalleVentas.id_venta, ids))
      .orderBy(asc(DetalleVentas.id)),
  ]);

  const folios = new Map(facturas.map((f) => [f.id_venta, f.folio]));

  return ventas.map((venta) => {
    const lineas = detalles.filter((d) => d.id_venta === venta.id);
    return {
      id: venta.id,
      folio: folios.get(venta.id) ?? null,
      fecha: venta.fecha,
      total: Number(venta.total),
      estado: venta.estado,
      unidades: lineas.reduce((total, l) => total + l.cantidad, 0),
      vistaPrevia: lineas.slice(0, 3).map((l) => ({ nombre: l.nombre, imagen: l.imagen, tema: l.tema })),
      productosExtra: Math.max(0, lineas.length - 3),
    };
  });
}

/**
 * Detalle completo de un pedido. Devuelve null si no existe o si no pertenece
 * al cliente, para que nadie pueda ver compras ajenas cambiando el id en la URL.
 */
export async function getDetalleCompra(clientId: number, ventaId: number): Promise<CompraDetalle | null> {
  if (!Number.isInteger(ventaId) || ventaId <= 0) return null;

  const [venta] = await db
    .select({
      id: Ventas.id,
      fecha: Ventas.fecha_venta,
      estado: Ventas.estado,
      fechaEntrega: Ventas.fecha_entrega,
      cupon: Ventas.cupon_descuento,
      subtotal: Ventas.subtotal,
      envio: Ventas.envio,
      total: Ventas.total,
      metodoPago: MetodosPago.nombre,
    })
    .from(Ventas)
    .leftJoin(MetodosPago, eq(Ventas.id_metodo_pago, MetodosPago.id))
    .where(and(eq(Ventas.id, ventaId), eq(Ventas.id_cliente, clientId)))
    .limit(1);

  if (!venta) return null;

  const [articulos, pagos, facturas, historial] = await Promise.all([
    db
      .select({
        id_producto: Productos.id,
        sku: Productos.sku,
        nombre: Modelos.nombre,
        categoria: Categorias.nombre,
        color: Productos.color,
        talla: Productos.talla_cm,
        imagen: Modelos.imagen_url,
        tema: Productos.theme_class,
        cantidad: DetalleVentas.cantidad,
        precioUnitario: DetalleVentas.precio_unitario,
        subtotal: DetalleVentas.subtotal,
      })
      .from(DetalleVentas)
      .innerJoin(Productos, eq(DetalleVentas.id_producto, Productos.id))
      .innerJoin(Modelos, eq(Productos.id_modelo, Modelos.id))
      .leftJoin(Categorias, eq(Modelos.id_categoria, Categorias.id))
      .where(eq(DetalleVentas.id_venta, venta.id))
      .orderBy(asc(DetalleVentas.id)),
    db
      .select({ estado: Pagos.estado, monto: Pagos.monto, fecha: Pagos.fecha_pago })
      .from(Pagos)
      .where(eq(Pagos.id_venta, venta.id))
      .limit(1),
    db
      .select({
        folio: Facturas.folio,
        uuid: Facturas.uuid,
        estado: Facturas.estado,
        fechaEmision: Facturas.fecha_emision,
        subtotal: Facturas.subtotal,
        iva: Facturas.iva,
      })
      .from(Facturas)
      .where(eq(Facturas.id_venta, venta.id))
      .limit(1),
    db
      .select({ estado: HistorialOrdenes.estado_nuevo, fecha: HistorialOrdenes.fecha })
      .from(HistorialOrdenes)
      .where(eq(HistorialOrdenes.id_venta, venta.id))
      .orderBy(asc(HistorialOrdenes.fecha), asc(HistorialOrdenes.id)),
  ]);

  const total = Number(venta.total);
  const factura = facturas[0];
  const desglose = factura
    ? { subtotal: Number(factura.subtotal), iva: Number(factura.iva) }
    : desglosarIva(total);

  return {
    id: venta.id,
    fecha: venta.fecha,
    estado: venta.estado,
    fechaEntrega: venta.fechaEntrega,
    cupon: venta.cupon,
    metodoPago: venta.metodoPago ?? 'No especificado',
    subtotal: Number(venta.subtotal),
    envio: Number(venta.envio),
    total,
    baseSinIva: desglose.subtotal,
    iva: desglose.iva,
    articulos: articulos.map((a) => ({
      id_producto: a.id_producto,
      sku: a.sku,
      nombre: a.nombre,
      categoria: a.categoria,
      variante: variante(a.color, a.talla),
      imagen: a.imagen,
      tema: a.tema,
      cantidad: a.cantidad,
      precioUnitario: Number(a.precioUnitario),
      subtotal: Number(a.subtotal),
    })),
    pago: pagos[0] ? { estado: pagos[0].estado, monto: Number(pagos[0].monto), fecha: pagos[0].fecha } : null,
    factura: factura
      ? { folio: factura.folio, uuid: factura.uuid, estado: factura.estado, fechaEmision: factura.fechaEmision }
      : null,
    historial,
  };
}

/** Pasos del seguimiento del pedido y en cuál va; las canceladas no tienen progreso. */
export const PASOS_PEDIDO = ['Procesando', 'Confirmada', 'Entregada'] as const;

export const pasoActual = (estado: string): number => PASOS_PEDIDO.indexOf(estado as (typeof PASOS_PEDIDO)[number]);
