export type TipoDescuento = 'porcentaje' | 'monto';

export interface PromocionPrecio {
  tipo_descuento: TipoDescuento;
  valor: number | string;
  fecha_inicio: Date | string;
  fecha_fin: Date | string;
  estado: 'Activa' | 'Inactiva';
}

export interface ProductoConPromociones {
  precio_venta: number | string;
  promociones?: readonly PromocionPrecio[];
}

const aCentavos = (monto: number): number => Math.round((monto + Number.EPSILON) * 100);

const fechaEnMilisegundos = (fecha: Date | string): number => {
  const timestamp = fecha instanceof Date ? fecha.getTime() : new Date(fecha).getTime();
  if (!Number.isFinite(timestamp)) throw new RangeError('Fecha de promoción inválida.');
  return timestamp;
};

/** Devuelve el precio final; si coinciden varias promociones, aplica solo la más conveniente. */
export const precioConPromocion = (
  producto: ProductoConPromociones,
  fechaActual: Date = new Date(),
): number => {
  const precio = Number(producto.precio_venta);
  if (!Number.isFinite(precio) || precio < 0) throw new RangeError('Precio de producto inválido.');

  const precioBaseCentavos = aCentavos(precio);
  const ahora = fechaEnMilisegundos(fechaActual);
  let mejorPrecioCentavos = precioBaseCentavos;

  for (const promocion of producto.promociones ?? []) {
    if (promocion.estado !== 'Activa') continue;

    const inicio = fechaEnMilisegundos(promocion.fecha_inicio);
    const fin = fechaEnMilisegundos(promocion.fecha_fin);
    if (inicio > fin) throw new RangeError('La fecha de inicio de la promoción debe ser anterior a su fecha de fin.');
    if (ahora < inicio || ahora > fin) continue;

    const valor = Number(promocion.valor);
    if (!Number.isFinite(valor) || valor <= 0 || (promocion.tipo_descuento === 'porcentaje' && valor > 100)) {
      throw new RangeError('Valor de descuento inválido.');
    }

    const descuentoCentavos = promocion.tipo_descuento === 'porcentaje'
      ? Math.round(precioBaseCentavos * (valor / 100))
      : aCentavos(valor);
    mejorPrecioCentavos = Math.min(mejorPrecioCentavos, Math.max(0, precioBaseCentavos - descuentoCentavos));
  }

  return mejorPrecioCentavos / 100;
};
