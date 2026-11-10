import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import {
  PromocionError,
  etiquetaDescuento,
  leerFechaPromocion,
  precioAlPublico,
  precioConPromocion,
  validarCoherencia,
  validarPromocion,
  vigenciaPromocion,
  type PromocionPrecio,
} from '../src/lib/promociones';

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

describe('validarPromocion', () => {
  const completa = {
    nombre: '  Buen Fin  ',
    descripcion: '',
    tipo_descuento: 'porcentaje',
    valor: '15',
    fecha_inicio: '2026-11-13',
    fecha_fin: '2026-11-16',
    estado: 'Activa',
    productos: ['3', 3, 7],
  };

  it('normaliza los datos del formulario', () => {
    const datos = validarPromocion(completa);
    expect(datos).toMatchObject({ nombre: 'Buen Fin', descripcion: null, tipo_descuento: 'porcentaje', valor: 15, estado: 'Activa' });
    expect(datos.productos).toEqual([3, 7]);
  });

  it('una fecha sin hora cubre el día completo', () => {
    const datos = validarPromocion(completa);
    expect(datos.fecha_inicio).toEqual(new Date(2026, 10, 13, 0, 0, 0));
    expect(datos.fecha_fin).toEqual(new Date(2026, 10, 16, 23, 59, 59));
  });

  it('exige nombre, descuento positivo y al menos un producto', () => {
    expect(() => validarPromocion({ ...completa, nombre: ' ' })).toThrow(PromocionError);
    expect(() => validarPromocion({ ...completa, valor: 0 })).toThrow(PromocionError);
    expect(() => validarPromocion({ ...completa, valor: '' })).toThrow(PromocionError);
    expect(() => validarPromocion({ ...completa, productos: [] })).toThrow(PromocionError);
    expect(() => validarPromocion({ ...completa, productos: ['x'] })).toThrow(PromocionError);
    expect(() => validarPromocion({ ...completa, tipo_descuento: '2x1' })).toThrow(PromocionError);
    expect(() => validarPromocion({ ...completa, fecha_fin: 'mañana' })).toThrow(PromocionError);
  });

  it('en modo parcial solo revisa lo enviado', () => {
    expect(validarPromocion({ estado: 'Inactiva' }, true)).toEqual({ estado: 'Inactiva' });
    expect(() => validarPromocion({ estado: 'Pausada' }, true)).toThrow(PromocionError);
  });
});

describe('validarCoherencia', () => {
  const base = {
    tipo_descuento: 'porcentaje' as const,
    valor: 20,
    fecha_inicio: new Date('2026-11-01T00:00:00Z'),
    fecha_fin: new Date('2026-11-30T00:00:00Z'),
  };

  it('acepta una promoción válida', () => {
    expect(() => validarCoherencia(base)).not.toThrow();
    expect(() => validarCoherencia({ ...base, tipo_descuento: 'monto', valor: 500 })).not.toThrow();
  });

  it('rechaza porcentajes mayores a 100 y fechas invertidas', () => {
    expect(() => validarCoherencia({ ...base, valor: 120 })).toThrow(PromocionError);
    expect(() => validarCoherencia({ ...base, fecha_inicio: base.fecha_fin, fecha_fin: base.fecha_inicio })).toThrow(PromocionError);
  });
});

describe('vigenciaPromocion', () => {
  const promo = {
    estado: 'Activa' as const,
    fecha_inicio: new Date('2026-11-01T00:00:00Z'),
    fecha_fin: new Date('2026-11-30T23:59:59Z'),
  };

  it('clasifica por fechas y estado', () => {
    expect(vigenciaPromocion(promo, fechaActual)).toBe('Vigente');
    expect(vigenciaPromocion(promo, new Date('2026-10-31T00:00:00Z'))).toBe('Programada');
    expect(vigenciaPromocion(promo, new Date('2026-12-01T00:00:00Z'))).toBe('Vencida');
    expect(vigenciaPromocion({ ...promo, estado: 'Inactiva' }, fechaActual)).toBe('Inactiva');
  });
});

describe('leerFechaPromocion / etiquetaDescuento', () => {
  it('respeta una fecha con hora explícita', () => {
    expect(leerFechaPromocion('2026-11-13T10:30:00.000Z', 'inicio').toISOString()).toBe('2026-11-13T10:30:00.000Z');
  });

  it('muestra el descuento redondeado y nunca 0%', () => {
    expect(etiquetaDescuento(200, 160)).toBe('-20%');
    expect(etiquetaDescuento(1000, 999)).toBe('-1%');
  });
});

describe('precioAlPublico', () => {
  it('el precio de lista es el capturado en el producto (impuestos incluidos)', () => {
    expect(precioAlPublico(1, '2000.00', undefined, fechaActual)).toEqual({ lista: 2000, final: 2000 });
  });

  it('aplica la promoción vigente sobre ese precio', () => {
    expect(precioAlPublico(1, 2000, [promocion({ valor: 25 })], fechaActual)).toEqual({ lista: 2000, final: 1500 });
    expect(precioAlPublico(1, 2000, [promocion({ tipo_descuento: 'monto', valor: 150 })], fechaActual)).toEqual({ lista: 2000, final: 1850 });
  });

  it('una promoción dañada no bloquea la venta: se cobra el precio de lista', () => {
    const errores = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(precioAlPublico(1, 2000, [promocion({ valor: 500 })], fechaActual)).toEqual({ lista: 2000, final: 2000 });
    errores.mockRestore();
  });
});
