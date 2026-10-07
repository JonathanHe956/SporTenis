import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import {
  COSTO_ENVIO,
  ENVIO_GRATIS_DESDE,
  VentaError,
  calcularEnvio,
  calcularTotales,
  normalizarItems,
} from '../src/lib/ventas';

describe('calcularEnvio', () => {
  it('cobra envío por debajo del mínimo y lo regala a partir de él', () => {
    expect(calcularEnvio(ENVIO_GRATIS_DESDE - 0.01)).toBe(COSTO_ENVIO);
    expect(calcularEnvio(ENVIO_GRATIS_DESDE)).toBe(0);
  });

  it('no cobra envío en un pedido vacío', () => {
    expect(calcularEnvio(0)).toBe(0);
  });
});

describe('calcularTotales', () => {
  it('suma sin errores de punto flotante', () => {
    const totales = calcularTotales([{ precio: 0.1, cantidad: 3 }, { precio: 19.99, cantidad: 3 }], 0);
    expect(totales).toEqual({ subtotal: 60.27, envio: 0, total: 60.27 });
  });

  it('aplica la regla de envío cuando no se indica uno', () => {
    expect(calcularTotales([{ precio: 500, cantidad: 1 }])).toEqual({
      subtotal: 500,
      envio: COSTO_ENVIO,
      total: 500 + COSTO_ENVIO,
    });
    expect(calcularTotales([{ precio: 500, cantidad: 2 }]).envio).toBe(0);
  });

  it('respeta el envío indicado por el personal', () => {
    expect(calcularTotales([{ precio: 100, cantidad: 1 }], 150).total).toBe(250);
  });
});

describe('normalizarItems', () => {
  it('convierte valores numéricos enviados como texto', () => {
    expect(normalizarItems([{ id_producto: '3', cantidad: '2' }])).toEqual([{ id_producto: 3, cantidad: 2 }]);
  });

  it('conserva el precio fijado manualmente', () => {
    expect(normalizarItems([{ id_producto: 3, cantidad: 1, precio: 49.5 }])).toEqual([
      { id_producto: 3, cantidad: 1, precio: 49.5 },
    ]);
  });

  it.each([
    ['una lista vacía', []],
    ['algo que no es lista', 'x'],
    ['cantidad cero', [{ id_producto: 1, cantidad: 0 }]],
    ['cantidad negativa', [{ id_producto: 1, cantidad: -2 }]],
    ['cantidad decimal', [{ id_producto: 1, cantidad: 1.5 }]],
    ['producto inválido', [{ id_producto: 'abc', cantidad: 1 }]],
    ['precio negativo', [{ id_producto: 1, cantidad: 1, precio: -5 }]],
    ['un elemento nulo', [null]],
  ])('rechaza %s', (_caso, detalles) => {
    expect(() => normalizarItems(detalles)).toThrow(VentaError);
  });
});
