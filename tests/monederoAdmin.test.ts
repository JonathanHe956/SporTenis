import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { MonederoError } from '../src/lib/monedero';
import { armarReporteMensual, saldoTrasAjuste, validarAjuste } from '../src/lib/monederoAdmin';

describe('validarAjuste', () => {
  it('normaliza un ajuste válido a centavos', () => {
    expect(validarAjuste({ id_cliente: '7', tipo: 'abono', monto: '150.505', motivo: '  Compensación por retraso ' })).toEqual({
      idCliente: 7,
      tipo: 'abono',
      centavos: 15051,
      motivo: 'Compensación por retraso',
    });
  });

  it('rechaza cliente, tipo, monto o motivo inválidos', () => {
    const base = { id_cliente: 1, tipo: 'cargo', monto: 10, motivo: 'Corrección de cobro duplicado' };
    expect(() => validarAjuste({ ...base, id_cliente: 0 })).toThrow('cliente');
    expect(() => validarAjuste({ ...base, tipo: 'regalo' })).toThrow('abono o un cargo');
    expect(() => validarAjuste({ ...base, monto: 0 })).toThrow('mayor que cero');
    expect(() => validarAjuste({ ...base, monto: '' })).toThrow('mayor que cero');
    expect(() => validarAjuste({ ...base, monto: 'abc' })).toThrow('mayor que cero');
    expect(() => validarAjuste({ ...base, monto: 100_000.01 })).toThrow('100,000');
    expect(() => validarAjuste({ ...base, motivo: 'ok' })).toThrow('motivo');
    expect(() => validarAjuste({ ...base, motivo: 'x'.repeat(256) })).toThrow('255');
  });
});

describe('saldoTrasAjuste', () => {
  it('un abono suma al saldo', () => {
    expect(saldoTrasAjuste(10000, { tipo: 'abono', centavos: 2550 })).toBe(12550);
  });

  it('un cargo resta y puede dejar el saldo en cero', () => {
    expect(saldoTrasAjuste(10000, { tipo: 'cargo', centavos: 10000 })).toBe(0);
  });

  it('un cargo mayor que el saldo se rechaza', () => {
    expect(() => saldoTrasAjuste(5000, { tipo: 'cargo', centavos: 5001 })).toThrow(MonederoError);
  });
});

describe('armarReporteMensual', () => {
  it('agrupa por mes, separa recargas, compras, reembolsos y ajustes', () => {
    const reporte = armarReporteMensual([
      { periodo: '2026-10', tipo: 'Recarga', total: '500.00', cantidad: 2 },
      { periodo: '2026-11', tipo: 'Recarga', total: '1000.00', cantidad: 1 },
      { periodo: '2026-11', tipo: 'Canjeo', total: '200.10', cantidad: 1 },
      { periodo: '2026-11', tipo: 'RecargaTarjeta', total: '0.20', cantidad: 1 },
      { periodo: '2026-11', tipo: 'Descuento', total: '696.00', cantidad: 3 },
      { periodo: '2026-11', tipo: 'Reembolso', total: '150.00', cantidad: 1 },
      { periodo: '2026-11', tipo: 'AjusteAbono', total: '50.00', cantidad: 1 },
      { periodo: '2026-11', tipo: 'AjusteCargo', total: '20.00', cantidad: 1 },
    ]);

    expect(reporte.map((f) => f.periodo)).toEqual(['2026-11', '2026-10']);
    expect(reporte[0]).toEqual({ periodo: '2026-11', recargas: 1200.3, consumos: 696, reembolsos: 150, ajustes: 30, movimientos: 9 });
    expect(reporte[1]).toMatchObject({ recargas: 500, consumos: 0, movimientos: 2 });
  });

  it('sin movimientos el reporte queda vacío', () => {
    expect(armarReporteMensual([])).toEqual([]);
  });
});
