import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { ajustarAlStock, resumirCarrito, type CartItem } from '../src/lib/cart';

const item = (cambios: Partial<CartItem>): CartItem => ({
  id_producto: 1,
  nombre: 'Court Air 2.0',
  categoria: 'Tenis',
  variante: 'Blanco - 27cm',
  precio: 1899,
  cantidad: 1,
  stock: 10,
  subtotal: 1899,
  ...cambios,
});

describe('ajustarAlStock', () => {
  it('deja igual el carrito cuando hay stock suficiente', () => {
    const carrito = [item({ cantidad: 2, subtotal: 3798 })];
    expect(ajustarAlStock(carrito)).toEqual({ items: carrito, avisos: [] });
  });

  it('quita el producto que se agotó y avisa', () => {
    const { items, avisos } = ajustarAlStock([item({ stock: 0 }), item({ id_producto: 2, nombre: 'Pala Pro' })]);
    expect(items.map((i) => i.id_producto)).toEqual([2]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('se agotó');
  });

  it('baja la cantidad a lo disponible y recalcula el subtotal', () => {
    const { items, avisos } = ajustarAlStock([item({ cantidad: 5, stock: 2, subtotal: 9495 })]);
    expect(items[0]).toMatchObject({ cantidad: 2, subtotal: 3798 });
    expect(avisos[0]).toContain('Solo quedan 2');
  });

  it('trata un stock negativo como agotado', () => {
    expect(ajustarAlStock([item({ stock: -3 })]).items).toEqual([]);
  });
});

describe('resumirCarrito', () => {
  it('desglosa el IVA del total cuando el envío es gratis', () => {
    const resumen = resumirCarrito([item({ precio: 2400, subtotal: 2400 })]);
    expect(resumen).toMatchObject({ subtotal: 2400, envio: 0, total: 2400, unidades: 1, tasa_iva: 0.16 });
    expect(resumen.base_sin_iva).toBe(2068.97);
    expect(resumen.iva).toBe(331.03);
  });

  it('incluye el envío en el desglose y no pierde centavos', () => {
    const resumen = resumirCarrito([item({ precio: 1500, subtotal: 1500 })]);
    expect(resumen).toMatchObject({ subtotal: 1500, envio: 500, total: 2000 });
    expect(resumen.base_sin_iva).toBe(1724.14);
    expect(resumen.iva).toBe(275.86);
    expect(Math.round((resumen.base_sin_iva + resumen.iva) * 100)).toBe(Math.round(resumen.total * 100));
  });
});
