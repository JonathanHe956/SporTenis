import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { PagoError, autorizarPago, esFormaPago, marcaTarjeta, pasaLuhn, validarTarjeta } from '../src/lib/pagos';

const hoy = new Date('2026-11-10T12:00:00');
const tarjeta = (cambios: Record<string, string> = {}) => ({
  numero: '4242 4242 4242 4242',
  titular: 'Ana López',
  vencimiento: '12/28',
  cvv: '123',
  ...cambios,
});

describe('pasaLuhn / marcaTarjeta', () => {
  it('reconoce números válidos e inválidos', () => {
    expect(pasaLuhn('4242424242424242')).toBe(true);
    expect(pasaLuhn('4242424242424241')).toBe(false);
    expect(pasaLuhn('378282246310005')).toBe(true);
  });

  it('detecta la marca por el inicio del número', () => {
    expect(marcaTarjeta('4242424242424242')).toBe('Visa');
    expect(marcaTarjeta('5555555555554444')).toBe('Mastercard');
    expect(marcaTarjeta('2223003122003222')).toBe('Mastercard');
    expect(marcaTarjeta('378282246310005')).toBe('American Express');
    expect(marcaTarjeta('6011111111111117')).toBeNull();
  });
});

describe('validarTarjeta', () => {
  it('acepta una tarjeta válida y devuelve solo marca y últimos 4', () => {
    expect(validarTarjeta(tarjeta(), hoy)).toMatchObject({ marca: 'Visa', ultimos4: '4242' });
  });

  it('American Express lleva 15 dígitos y CVV de 4', () => {
    expect(validarTarjeta(tarjeta({ numero: '3782 822463 10005', cvv: '1234' }), hoy).marca).toBe('American Express');
    expect(() => validarTarjeta(tarjeta({ numero: '378282246310005', cvv: '123' }), hoy)).toThrow('4 dígitos');
  });

  it('rechaza número, titular, vencimiento o CVV inválidos', () => {
    expect(() => validarTarjeta(tarjeta({ numero: '4242424242424241' }), hoy)).toThrow('número de tarjeta');
    expect(() => validarTarjeta(tarjeta({ titular: 'A' }), hoy)).toThrow('titular');
    expect(() => validarTarjeta(tarjeta({ vencimiento: '13/28' }), hoy)).toThrow('MM/AA');
    expect(() => validarTarjeta(tarjeta({ cvv: '12' }), hoy)).toThrow('3 dígitos');
    expect(() => validarTarjeta(undefined, hoy)).toThrow(PagoError);
  });

  it('la tarjeta vale hasta el último día de su mes de vencimiento', () => {
    expect(() => validarTarjeta(tarjeta({ vencimiento: '11/26' }), hoy)).not.toThrow();
    expect(() => validarTarjeta(tarjeta({ vencimiento: '10/26' }), hoy)).toThrow('vencida');
  });
});

describe('autorizarPago (simulado)', () => {
  it('aprueba una tarjeta y guarda solo la referencia enmascarada', () => {
    expect(autorizarPago('tarjeta_credito', { tarjeta: tarjeta() })).toEqual({
      forma: 'tarjeta_credito',
      referencia: 'Visa •••• 4242',
    });
  });

  it('rechaza las tarjetas de prueba con un 402', () => {
    const intento = () => autorizarPago('tarjeta_credito', { tarjeta: tarjeta({ numero: '4000000000000002' }) });
    expect(intento).toThrow('rechazó');
    try { intento(); } catch (error) { expect((error as PagoError).status).toBe(402); }
    expect(() => autorizarPago('tarjeta_debito', { tarjeta: tarjeta({ numero: '4000000000009995' }) })).toThrow('Fondos insuficientes');
  });

  it('no acepta American Express como débito', () => {
    expect(() => autorizarPago('tarjeta_debito', { tarjeta: tarjeta({ numero: '378282246310005', cvv: '1234' }) })).toThrow('crédito');
  });

  it('Mercado Pago no se acepta como venta directa: el navegador no puede decir que ya pagó', () => {
    expect(() => autorizarPago('mercado_pago', { mercado_pago: { estado: 'aprobado' } })).toThrow('su página');
  });

  it('el monedero no se autoriza aquí: se cobra dentro de la venta', () => {
    expect(autorizarPago('monedero', {})).toEqual({ forma: 'monedero', referencia: null });
  });

  it('solo acepta las formas de pago conocidas', () => {
    expect(esFormaPago('mercado_pago')).toBe(true);
    expect(esFormaPago('paypal')).toBe(false);
    expect(esFormaPago('toString')).toBe(false);
  });
});
