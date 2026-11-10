import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { MonederoError, SaldoInsuficienteError } from '../src/lib/monedero';

describe('SaldoInsuficienteError', () => {
  it('dice cuánto tiene, cuánto cuesta y cuánto falta', () => {
    const error = new SaldoInsuficienteError(100050, 220000);
    expect(error).toBeInstanceOf(MonederoError);
    expect(error.status).toBe(409);
    expect(error).toMatchObject({ saldo: 1000.5, total: 2200, faltante: 1199.5 });
    expect(error.message).toContain('$1,000.50');
    expect(error.message).toContain('$2,200.00');
    expect(error.message).toContain('Te faltan $1,199.50');
  });
});
