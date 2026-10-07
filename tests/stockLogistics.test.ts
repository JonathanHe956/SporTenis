import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { calcularCantidadReponer, requiereReposicion } from '../src/lib/stockLogistics';

describe('requiereReposicion', () => {
  it('avisa cuando el stock llega al mínimo o baja de él', () => {
    expect(requiereReposicion(5, 5)).toBe(true);
    expect(requiereReposicion(0, 5)).toBe(true);
  });

  it('no avisa mientras el stock supere el mínimo', () => {
    expect(requiereReposicion(6, 5)).toBe(false);
  });

  it('ignora productos sin mínimo configurado', () => {
    expect(requiereReposicion(0, 0)).toBe(false);
  });
});

describe('calcularCantidadReponer', () => {
  it('sin configuración repone hasta el doble del mínimo', () => {
    expect(calcularCantidadReponer(4, 10)).toBe(16);
    expect(calcularCantidadReponer(0, 10)).toBe(20);
  });

  it('nunca repone menos que el mínimo ni menos de 5 unidades', () => {
    expect(calcularCantidadReponer(10, 10)).toBe(10);
    expect(calcularCantidadReponer(2, 2)).toBe(5);
  });

  it('usa la cantidad de reorden configurada, sin bajar del mínimo', () => {
    expect(calcularCantidadReponer(1, 10, 50)).toBe(50);
    expect(calcularCantidadReponer(1, 10, 3)).toBe(10);
  });
});
