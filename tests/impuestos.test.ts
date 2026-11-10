import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { desglosarIva } from '../src/lib/facturacion';
import { IVA_POR_DEFECTO, ImpuestoError, porcentajeATasa, tasaDesdeRegistro, validarImpuesto } from '../src/lib/impuestos';

describe('porcentajeATasa', () => {
  it('convierte el porcentaje guardado en la tasa de cálculo', () => {
    expect(porcentajeATasa(16)).toBe(0.16);
    expect(porcentajeATasa(8)).toBe(0.08);
    expect(porcentajeATasa(10.5)).toBe(0.105);
    expect(porcentajeATasa(0)).toBe(0);
  });
});

describe('tasaDesdeRegistro', () => {
  it('usa el porcentaje configurado cuando el IVA está activo', () => {
    expect(tasaDesdeRegistro({ porcentaje: 8, estado: 'Activo' })).toBe(0.08);
  });

  it('no cobra IVA si el administrador lo desactiva', () => {
    expect(tasaDesdeRegistro({ porcentaje: 16, estado: 'Inactivo' })).toBe(0);
  });

  it('usa el 16% de siempre si todavía no hay registro', () => {
    expect(tasaDesdeRegistro(undefined)).toBe(IVA_POR_DEFECTO);
    expect(IVA_POR_DEFECTO).toBe(0.16);
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
