import { describe, expect, it } from 'vitest';

import { precioConPromocion, type PromocionPrecio } from '../src/lib/promociones';

const fechaActual = new Date('2026-11-09T12:00:00.000Z');
const promocion = (overrides: Partial<PromocionPrecio> = {}): PromocionPrecio => ({
  tipo_descuento: 'porcentaje',
  valor: 20,
  fecha_inicio: '2026-11-01T00:00:00.000Z',
  fecha_fin: '2026-11-30T23:59:59.000Z',
  estado: 'Activa',
  ...overrides,
});

describe('precioConPromocion', () => {
  it('aplica un descuento porcentual y redondea a centavos', () => {
    expect(precioConPromocion({
      precio_venta: '199.99',
      promociones: [promocion()],
    }, fechaActual)).toBe(159.99);
  });

  it('aplica un descuento de monto sin permitir un precio negativo', () => {
    expect(precioConPromocion({
      precio_venta: 100,
      promociones: [promocion({ tipo_descuento: 'monto', valor: '25.50' })],
    }, fechaActual)).toBe(74.5);
    expect(precioConPromocion({
      precio_venta: 100,
      promociones: [promocion({ tipo_descuento: 'monto', valor: 150 })],
    }, fechaActual)).toBe(0);
  });

  it('ignora promociones inactivas, futuras o vencidas', () => {
    expect(precioConPromocion({
      precio_venta: 100,
      promociones: [
        promocion({ estado: 'Inactiva' }),
        promocion({ fecha_inicio: '2026-11-10T00:00:00.000Z' }),
        promocion({ fecha_fin: '2026-11-08T23:59:59.000Z' }),
      ],
    }, fechaActual)).toBe(100);
  });

  it('usa la promoción más conveniente sin acumular descuentos', () => {
    expect(precioConPromocion({
      precio_venta: 100,
      promociones: [
        promocion({ valor: 10 }),
        promocion({ tipo_descuento: 'monto', valor: 25 }),
      ],
    }, fechaActual)).toBe(75);
  });

  it('conserva el precio si el producto no tiene promociones', () => {
    expect(precioConPromocion({ precio_venta: '20.00' }, fechaActual)).toBe(20);
  });

  it('rechaza valores de precio o descuento inválidos', () => {
    expect(() => precioConPromocion({ precio_venta: -1 }, fechaActual)).toThrow(RangeError);
    expect(() => precioConPromocion({
      precio_venta: 100,
      promociones: [promocion({ valor: 101 })],
    }, fechaActual)).toThrow(RangeError);
  });
});
