import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/db';
import { Carritos, Categorias, DetalleCarritos, Modelos, Productos } from '../db/schema';
import { calcularTotales, type ItemVenta, type TotalesVenta } from './ventas';

/** Error de negocio cuyo mensaje sí se puede mostrar al usuario. */
export class CartError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'CartError';
    this.status = status;
  }
}

export interface CartItem {
  id_producto: number;
  nombre: string;
  categoria: string | null;
  variante: string;
  precio: number;
  cantidad: number;
  stock: number;
  subtotal: number;
}

export interface CartSummary extends TotalesVenta {
  unidades: number;
}

const findCartId = async (clientId: number): Promise<number | null> => {
  const cart = await db
    .select({ id: Carritos.id })
    .from(Carritos)
    .where(eq(Carritos.id_cliente, clientId))
    .orderBy(asc(Carritos.id));

  return cart[0]?.id ?? null;
};

const getOrCreateCartId = async (clientId: number): Promise<number> => {
  const existing = await findCartId(clientId);
  if (existing) return existing;

  const created = await db.insert(Carritos).values({
    id_cliente: clientId,
    fecha_actualizacion: new Date(),
  });
  return Number(created[0].insertId);
};

export const getCartItems = async (clientId: number): Promise<CartItem[]> => {
  const cartId = await findCartId(clientId);
  if (!cartId) return [];

  const rows = await db
    .select({
      id_producto: Productos.id,
      nombre: Modelos.nombre,
      categoria: Categorias.nombre,
      color: Productos.color,
      talla: Productos.talla_cm,
      precio: Productos.precio_venta,
      cantidad: DetalleCarritos.cantidad,
      stock: Productos.stock,
    })
    .from(DetalleCarritos)
    .innerJoin(Productos, eq(DetalleCarritos.id_producto, Productos.id))
    .innerJoin(Modelos, eq(Productos.id_modelo, Modelos.id))
    .leftJoin(Categorias, eq(Modelos.id_categoria, Categorias.id))
    .where(eq(DetalleCarritos.id_carrito, cartId))
    .orderBy(asc(DetalleCarritos.id));

  return rows.map((row) => {
    const precio = Number(row.precio);
    return {
      id_producto: row.id_producto,
      nombre: row.nombre,
      categoria: row.categoria,
      variante: [row.color, row.talla ? `${row.talla}cm` : ''].filter(Boolean).join(' - ') || 'Estándar',
      precio,
      cantidad: row.cantidad,
      stock: row.stock,
      subtotal: calcularTotales([{ precio, cantidad: row.cantidad }], 0).subtotal,
    };
  });
};

export const resumirCarrito = (items: CartItem[]): CartSummary => ({
  ...calcularTotales(items),
  unidades: items.reduce((total, item) => total + item.cantidad, 0),
});

export const carritoAItemsVenta = (items: CartItem[]): ItemVenta[] =>
  items.map((item) => ({ id_producto: item.id_producto, cantidad: item.cantidad }));

/**
 * Fija la cantidad de un producto en el carrito (o la suma a la existente con `sumar`).
 * Una cantidad final de 0 o menos quita el producto.
 */
export const setCartItem = async (
  clientId: number,
  productId: number,
  cantidad: number,
  options: { sumar?: boolean } = {},
): Promise<void> => {
  if (!Number.isInteger(productId) || productId <= 0) throw new CartError('Producto inválido.');
  if (!Number.isInteger(cantidad)) throw new CartError('Cantidad inválida.');

  const cartId = await getOrCreateCartId(clientId);
  const existing = await db
    .select({ id: DetalleCarritos.id, cantidad: DetalleCarritos.cantidad })
    .from(DetalleCarritos)
    .where(and(eq(DetalleCarritos.id_carrito, cartId), eq(DetalleCarritos.id_producto, productId)));

  const nuevaCantidad = options.sumar ? (existing[0]?.cantidad ?? 0) + cantidad : cantidad;

  if (nuevaCantidad <= 0) {
    if (existing[0]) await db.delete(DetalleCarritos).where(eq(DetalleCarritos.id, existing[0].id));
  } else {
    const product = await db
      .select({ stock: Productos.stock, estado: Productos.estado })
      .from(Productos)
      .where(eq(Productos.id, productId));

    if (!product[0] || product[0].estado !== 'Activo') throw new CartError('Producto no encontrado.', 404);
    if (nuevaCantidad > product[0].stock) {
      throw new CartError(`Solo hay ${product[0].stock} unidades disponibles.`, 409);
    }

    if (existing[0]) {
      await db.update(DetalleCarritos).set({ cantidad: nuevaCantidad }).where(eq(DetalleCarritos.id, existing[0].id));
    } else {
      await db.insert(DetalleCarritos).values({ id_carrito: cartId, id_producto: productId, cantidad: nuevaCantidad });
    }
  }

  await db.update(Carritos).set({ fecha_actualizacion: new Date() }).where(eq(Carritos.id, cartId));
};

export const clearCart = async (clientId: number): Promise<void> => {
  const cartId = await findCartId(clientId);
  if (!cartId) return;

  await db.delete(DetalleCarritos).where(eq(DetalleCarritos.id_carrito, cartId));
  await db.update(Carritos).set({ fecha_actualizacion: new Date() }).where(eq(Carritos.id, cartId));
};
