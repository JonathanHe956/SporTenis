import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import {
  MAX_TARJETAS_POR_LOTE,
  generarCodigoTarjeta,
  hashCodigoTarjeta,
  nombreLote,
  normalizarCodigoTarjeta,
  validarCantidadTarjetas,
} from '../src/lib/tarjetasRegalo';
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

  it('acepta códigos con la estructura ST-XXXX-XXXX-XXXX-XXXX', () => {
    for (const codigo of ['ST-D7TF-79SW-6TXM-HKJU', 'ST-VXU2-HD2A-QNMR-WFYJ', 'ST-5A9P-4KPF-MEYS-729U']) {
      expect(() => hashCodigoTarjeta(codigo), codigo).not.toThrow();
    }
  });

  it('genera códigos distintos en un lote', () => {
    const codigos = new Set(Array.from({ length: 200 }, generarCodigoTarjeta));
    expect(codigos.size).toBe(200);
  });

  it('permite generar entre 1 y el máximo de tarjetas por lote', () => {
    expect(validarCantidadTarjetas('10')).toBe(10);
    expect(validarCantidadTarjetas(20)).toBe(20);
    for (const valor of [0, -1, 2.5, MAX_TARJETAS_POR_LOTE + 1, 'diez', '']) {
      expect(() => validarCantidadTarjetas(valor), String(valor)).toThrow(MonederoError);
    }
  });

  it('nombra el lote con la fecha y hora de generación', () => {
    expect(nombreLote(new Date(2026, 10, 12, 8, 5, 3))).toBe('L-20261112-080503');
  });
});

