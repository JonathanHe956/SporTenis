import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import { generarCodigoTarjeta, hashCodigoTarjeta, normalizarCodigoTarjeta } from '../src/lib/tarjetasRegalo';
import { MonederoError } from '../src/lib/monedero';

describe('tarjetas de regalo', () => {
  it('genera códigos con el formato para imprimir en una tarjeta', () => {
    expect(generarCodigoTarjeta()).toMatch(/^ST-[23456789A-HJ-NP-Z]{4}(?:-[23456789A-HJ-NP-Z]{4}){3}$/);
  });

  it('normaliza mayúsculas, guiones y espacios para el canje', () => {
    expect(normalizarCodigoTarjeta(' st-abcd-2345-efgh-6789 ')).toBe('STABCD2345EFGH6789');
  });

  it('produce el mismo hash para un código en distintos formatos', () => {
    expect(hashCodigoTarjeta('st-abcd-2345-efgh-6789')).toBe(hashCodigoTarjeta('STABCD2345EFGH6789'));
  });

  it('rechaza códigos con formato incorrecto antes de consultar la base', () => {
    expect(() => hashCodigoTarjeta('ST-INVALIDO')).toThrow(MonederoError);
  });
});
