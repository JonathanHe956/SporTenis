import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import { TARJETA_DEMO, saldoInicialTarjetaDemo, validarDatosTarjetaDemo } from '../src/lib/tarjetaDemo';
import { MonederoError } from '../src/lib/monedero';

describe('tarjeta bancaria ficticia', () => {
  const hoy = new Date('2026-11-11T12:00:00Z');

  it('inicia con $40,000 MXN ficticios', () => {
    expect(saldoInicialTarjetaDemo).toBe(40000);
  });

  it('acepta los datos de prueba sin espacios en el numero', () => {
    expect(() => validarDatosTarjetaDemo(TARJETA_DEMO.numero, '12/30', '123', hoy)).not.toThrow();
  });

  it('normaliza el numero de tarjeta escrito con espacios', () => {
    expect(() => validarDatosTarjetaDemo('9999 0000 0000 4000', '12/30', '123', hoy)).not.toThrow();
  });

  it('rechaza cualquier numero de tarjeta que no sea el ficticio', () => {
    expect(() => validarDatosTarjetaDemo('4242 4242 4242 4242', '12/30', '123', hoy)).toThrow(MonederoError);
  });

  it('rechaza un CVV diferente', () => {
    expect(() => validarDatosTarjetaDemo(TARJETA_DEMO.numero, '12/30', '999', hoy)).toThrow(MonederoError);
  });

  it('rechaza un vencimiento que no corresponda a la tarjeta de demostracion', () => {
    expect(() => validarDatosTarjetaDemo(TARJETA_DEMO.numero, '10/26', '123', hoy)).toThrow(MonederoError);
  });
});
