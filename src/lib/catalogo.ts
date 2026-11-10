// Productos activos tal como los muestra la tienda (tarjetas, detalle y panel de favoritos).
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/db';
import { Categorias, Clientes, Favoritos, Modelos, Productos } from '../db/schema';
import { desglosarImpuestos, impuestosVigentes } from './impuestos';
import { etiquetaDescuento, preciosVigentes } from './promociones';

export interface StoreProduct {
  id: number;
  /** Nombre con su variante, p. ej. "Pala Pro Carbon - Negro / Verde". */
  name: string;
  originalName: string;
  type: string;
  /** Precio que se cobra (impuestos incluidos), con la promoción vigente si hay. */
  priceValue: number;
  /** Precio con formato, sin la moneda: "$2,400". */
  price: string;
  /** Precio de lista con formato cuando hay promoción; vacío si no. */
  originalPrice: string;
  /** Impuestos incluidos en el precio, con formato: "$331.03". No se suman: ya vienen dentro. */
  taxIncluded: string;
  /** Desglose por impuesto para el detalle: "IVA 16%: $331.03". */
  taxDetail: string[];
  /** Badge del producto; con promoción vigente muestra el descuento ("-20%"). */
  badge: string;
  className: string;
  imageUrl: string | null;
  description: string;
  options: string[];
}

export const formatPrecio = (value: number): string =>
  `$${value.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Montos de impuesto siempre con centavos: "$331.03". */
const formatImpuesto = (value: number): string =>
  `$${value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Productos activos; con `ids` solo esos (lista vacía = ninguno). */
export async function getStoreProducts(ids?: number[]): Promise<StoreProduct[]> {
  if (ids && ids.length === 0) return [];

  const activos = eq(Productos.estado, 'Activo');
  const rows = await db
    .select({
      id: Productos.id,
      name: Modelos.nombre,
      type: Categorias.nombre,
      price: Productos.precio_venta,
      badge: Productos.badge,
      className: Productos.theme_class,
      imageUrl: Modelos.imagen_url,
      description: Modelos.descripcion,
      color: Productos.color,
      talla: Productos.talla_cm,
    })
    .from(Productos)
    .innerJoin(Modelos, eq(Productos.id_modelo, Modelos.id))
    .innerJoin(Categorias, eq(Modelos.id_categoria, Categorias.id))
    .where(ids ? and(activos, inArray(Productos.id, ids)) : activos);

  const [precios, impuestos] = await Promise.all([
    preciosVigentes(rows.map((p) => ({ id: p.id, precio_venta: p.price }))),
    impuestosVigentes(),
  ]);

  return rows.map((p) => {
    const suffix = [p.color, p.talla ? `${p.talla}cm` : ''].filter(Boolean).join(' - ');
    const { lista: listPrice, final: priceValue } = precios.get(p.id)!;
    const enPromocion = priceValue < listPrice;
    // El precio ya incluye los impuestos: solo se muestra cuánto de él son impuestos
    const desglose = desglosarImpuestos(priceValue, impuestos);
    return {
      id: p.id,
      name: suffix ? `${p.name} - ${suffix}` : p.name,
      originalName: p.name,
      type: p.type,
      priceValue,
      price: formatPrecio(priceValue),
      originalPrice: enPromocion ? formatPrecio(listPrice) : '',
      taxIncluded: desglose.total_impuestos > 0 ? formatImpuesto(desglose.total_impuestos) : '',
      taxDetail: desglose.impuestos
        .filter((imp) => imp.monto > 0)
        .map((imp) => `${imp.nombre} ${imp.porcentaje.toLocaleString('es-MX', { maximumFractionDigits: 2 })}%: ${formatImpuesto(imp.monto)}`),
      badge: enPromocion ? etiquetaDescuento(listPrice, priceValue) : p.badge || '',
      className: p.className || '',
      imageUrl: p.imageUrl || null,
      description: p.description || '',
      options: suffix ? [suffix] : ['Estándar'],
    };
  });
}

/** Ids de los productos favoritos del usuario (vacío si no tiene ficha de cliente). */
export async function getFavoriteIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ productId: Favoritos.id_producto })
    .from(Favoritos)
    .innerJoin(Clientes, eq(Favoritos.id_cliente, Clientes.id))
    .where(eq(Clientes.id_usuario, userId));
  return rows.map((r) => r.productId);
}

/** Atributos data-* que lee el diálogo de detalle de producto. */
export const productDataAttrs = (p: StoreProduct) => ({
  'data-product-id': p.id,
  'data-product': p.name,
  'data-type': p.type,
  'data-price': p.price,
  'data-original-price': p.originalPrice,
  'data-tax-included': p.taxIncluded,
  'data-tax-detail': p.taxDetail.join('|'),
  'data-description': p.description,
  'data-options': p.options.join('|'),
  'data-badge': p.badge,
  'data-image': p.imageUrl || '',
  'data-theme': p.className,
});
