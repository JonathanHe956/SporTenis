import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { desglosarIva, estadoConciliacion, folioFactura } from '../src/lib/facturacion';
import { semanaAnterior } from '../src/lib/reportesProgramados';

describe('desglosarIva', () => {
  it('separa el IVA incluido sin perder centavos', () => {
    expect(desglosarIva(1160)).toEqual({ subtotal: 1000, iva: 160, total: 1160 });

    const { subtotal, iva, total } = desglosarIva(2499);
    expect(total).toBe(2499);
    expect(Math.round((subtotal + iva) * 100)).toBe(249900);
  });
});

describe('estadoConciliacion', () => {
  it('concilia solo cuando el cobro coincide con lo facturado', () => {
    expect(estadoConciliacion(1998, 1998)).toBe('Conciliado');
    expect(estadoConciliacion(1998, 1998.01)).toBe('Con diferencia');
  });
});

describe('folioFactura', () => {
  it('deriva el folio del número de venta', () => {
    expect(folioFactura(12)).toBe('FAC-000012');
  });
});

describe('semanaAnterior', () => {
  it('devuelve el lunes a domingo anteriores a la semana en curso', () => {
    // Miércoles 14 de octubre de 2026
    expect(semanaAnterior(new Date(2026, 9, 14, 10))).toMatchObject({ inicio: '2026-10-05', fin: '2026-10-11' });
    // En lunes la semana recién terminada ya se puede reportar
    expect(semanaAnterior(new Date(2026, 9, 12, 0, 5))).toMatchObject({ inicio: '2026-10-05', fin: '2026-10-11' });
    // En domingo la semana en curso todavía no termina
    expect(semanaAnterior(new Date(2026, 9, 11, 23))).toMatchObject({ inicio: '2026-09-28', fin: '2026-10-04' });
  });
});
