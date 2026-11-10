import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { DireccionError, formatearDireccion, validarDireccion } from '../src/lib/direcciones';

const datos = (cambios: Record<string, unknown> = {}) => ({
  alias: ' Casa ',
  destinatario: 'Ana   López',
  telefono: '55 1234-5678',
  calle: 'Av. Reforma 123, int. 4',
  colonia: 'Juárez',
  ciudad: 'Cuauhtémoc',
  estado: 'Ciudad de México',
  cp: '06600',
  referencias: '',
  ...cambios,
});

describe('validarDireccion', () => {
  it('limpia espacios y deja solo los dígitos del teléfono', () => {
    expect(validarDireccion(datos())).toEqual({
      alias: 'Casa',
      destinatario: 'Ana López',
      telefono: '5512345678',
      calle: 'Av. Reforma 123, int. 4',
      colonia: 'Juárez',
      ciudad: 'Cuauhtémoc',
      estado: 'Ciudad de México',
      cp: '06600',
      referencias: null,
    });
  });

  it('todos los campos son obligatorios menos las referencias', () => {
    expect(() => validarDireccion(datos({ alias: '' }))).toThrow('nombre de la dirección');
    expect(validarDireccion(datos({ referencias: '' })).referencias).toBeNull();
  });

  it('exige teléfono de 10 dígitos, CP de 5 y un estado de México', () => {
    expect(() => validarDireccion(datos({ telefono: '12345' }))).toThrow('10 dígitos');
    expect(() => validarDireccion(datos({ cp: '6600' }))).toThrow('5 dígitos');
    expect(() => validarDireccion(datos({ estado: 'Texas' }))).toThrow('estado');
  });

  it('exige quién recibe, calle, colonia y ciudad', () => {
    for (const campo of ['destinatario', 'calle', 'colonia', 'ciudad']) {
      expect(() => validarDireccion(datos({ [campo]: '  ' }))).toThrow(DireccionError);
    }
  });
});

describe('formatearDireccion', () => {
  it('arma la copia que se guarda en la venta', () => {
    expect(formatearDireccion(validarDireccion(datos({ referencias: 'Portón negro' })))).toBe(
      'Ana López · Tel. 5512345678\nAv. Reforma 123, int. 4, Col. Juárez\nCuauhtémoc, Ciudad de México, C.P. 06600\nReferencias: Portón negro',
    );
  });

  it('omite la línea de referencias si no hay', () => {
    expect(formatearDireccion(validarDireccion(datos())).split('\n')).toHaveLength(3);
  });
});
