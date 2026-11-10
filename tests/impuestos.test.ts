import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { desglosarIva } from '../src/lib/facturacion';
import {
  IVA_POR_DEFECTO,
  ImpuestoError,
  desglosarImpuestos,
  impuestosDesdeRegistros,
  porcentajeATasa,
  tasaTotal,
  validarImpuesto,
} from '../src/lib/impuestos';

const IVA = { nombre: 'IVA', porcentaje: 16, tasa: 0.16 };
const OTRO = { nombre: 'IEPS', porcentaje: 8, tasa: 0.08 };

describe('porcentajeATasa', () => {
  it('convierte el porcentaje guardado en la tasa de cálculo', () => {
    expect(porcentajeATasa(16)).toBe(0.16);
    expect(porcentajeATasa(8)).toBe(0.08);
    expect(porcentajeATasa(10.5)).toBe(0.105);
    expect(porcentajeATasa(0)).toBe(0);
  });
});

describe('impuestosDesdeRegistros', () => {
  it('toma todos los impuestos activos con su tasa', () => {
    expect(impuestosDesdeRegistros([
      { nombre: 'IVA', porcentaje: '16.00', estado: 'Activo' },
      { nombre: 'IEPS', porcentaje: '8.00', estado: 'Activo' },
      { nombre: 'Viejo', porcentaje: '3.00', estado: 'Inactivo' },
    ])).toEqual([IVA, OTRO]);
  });

  it('no cobra impuestos si todos están inactivos', () => {
    expect(impuestosDesdeRegistros([{ nombre: 'IVA', porcentaje: 16, estado: 'Inactivo' }])).toEqual([]);
  });

  it('usa el IVA del 16% de siempre si todavía no hay registros', () => {
    expect(impuestosDesdeRegistros([])).toEqual([IVA]);
    expect(IVA_POR_DEFECTO).toBe(0.16);
  });
});

describe('tasaTotal', () => {
  it('suma las tasas activas sin arrastrar errores de punto flotante', () => {
    expect(tasaTotal([IVA, OTRO])).toBe(0.24);
    expect(tasaTotal([{ nombre: 'a', porcentaje: 0.1, tasa: 0.001 }, { nombre: 'b', porcentaje: 0.2, tasa: 0.002 }])).toBe(0.003);
  });
});

describe('desglosarImpuestos', () => {
  it('separa la base y el monto de cada impuesto', () => {
    expect(desglosarImpuestos(1240, [IVA, OTRO])).toEqual({
      subtotal: 1000,
      impuestos: [{ nombre: 'IVA', porcentaje: 16, monto: 160 }, { nombre: 'IEPS', porcentaje: 8, monto: 80 }],
      total_impuestos: 240,
      total: 1240,
    });
  });

  it('no pierde centavos aunque el redondeo no cuadre', () => {
    const d = desglosarImpuestos(2499.99, [IVA, OTRO]);
    const suma = Math.round(d.subtotal * 100) + d.impuestos.reduce((t, i) => t + Math.round(i.monto * 100), 0);
    expect(suma).toBe(249999);
    expect(Math.round(d.total_impuestos * 100)).toBe(Math.round((d.total - d.subtotal) * 100));
  });

  it('un impuesto activo al 0% queda en $0 y el redondeo va al que sí cobra', () => {
    const d = desglosarImpuestos(1160.01, [IVA, { nombre: 'Cero', porcentaje: 0, tasa: 0 }]);
    expect(d.impuestos[1].monto).toBe(0);
    expect(Math.round((d.subtotal + d.impuestos[0].monto) * 100)).toBe(116001);
  });

  it('el precio capturado no cambia: cambiar o agregar impuestos solo cambia el desglose', () => {
    const conIva = desglosarImpuestos(2000, [IVA]);
    const conDos = desglosarImpuestos(2000, [IVA, OTRO]);
    expect(conIva).toMatchObject({ total: 2000, subtotal: 1724.14, total_impuestos: 275.86 });
    expect(conDos).toMatchObject({ total: 2000, subtotal: 1612.9, total_impuestos: 387.1 });
  });

  it('sin impuestos todo el total es base', () => {
    expect(desglosarImpuestos(500, [])).toEqual({ subtotal: 500, impuestos: [], total_impuestos: 0, total: 500 });
  });
});

describe('validarImpuesto', () => {
  it('limpia y normaliza un alta válida', () => {
    expect(validarImpuesto({ nombre: '  IEPS ', porcentaje: '8.456', estado: 'Activo' })).toEqual({
      nombre: 'IEPS',
      porcentaje: 8.46,
      estado: 'Activo',
    });
  });

  it('pone el impuesto como activo si no se indica estado', () => {
    expect(validarImpuesto({ nombre: 'IVA', porcentaje: 16 }).estado).toBe('Activo');
  });

  it('rechaza nombre vacío, porcentajes fuera de rango y estados desconocidos', () => {
    expect(() => validarImpuesto({ nombre: '', porcentaje: 16 })).toThrow(ImpuestoError);
    expect(() => validarImpuesto({ nombre: 'IVA', porcentaje: -1 })).toThrow('entre 0 y 100');
    expect(() => validarImpuesto({ nombre: 'IVA', porcentaje: 101 })).toThrow('entre 0 y 100');
    expect(() => validarImpuesto({ nombre: 'IVA', porcentaje: 'abc' })).toThrow('número');
    expect(() => validarImpuesto({ nombre: 'IVA', porcentaje: '' })).toThrow('número');
    expect(() => validarImpuesto({ nombre: 'IVA', porcentaje: 16, estado: 'Borrado' })).toThrow('Activo o Inactivo');
  });

  it('en una actualización parcial solo valida los campos enviados', () => {
    expect(validarImpuesto({ estado: 'Inactivo' }, true)).toEqual({ estado: 'Inactivo' });
    expect(validarImpuesto({ porcentaje: 8 }, true)).toEqual({ porcentaje: 8 });
    expect(() => validarImpuesto({ porcentaje: 200 }, true)).toThrow(ImpuestoError);
  });
});

describe('desglosarIva con tasa configurable', () => {
  it('sigue usando el 16% si no se indica tasa', () => {
    expect(desglosarIva(1160)).toEqual({ subtotal: 1000, iva: 160, total: 1160 });
  });

  it('aplica la tasa configurada sin perder centavos', () => {
    expect(desglosarIva(1080, 0.08)).toEqual({ subtotal: 1000, iva: 80, total: 1080 });

    const { subtotal, iva, total } = desglosarIva(2499, 0.08);
    expect(total).toBe(2499);
    expect(Math.round((subtotal + iva) * 100)).toBe(249900);
  });

  it('con IVA desactivado todo el total es base', () => {
    expect(desglosarIva(500, 0)).toEqual({ subtotal: 500, iva: 0, total: 500 });
  });
});
