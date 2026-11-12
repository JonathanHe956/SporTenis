import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import {
  RecuperacionError,
  enlaceVigente,
  formatoTokenValido,
  generarToken,
  hashToken,
  validarNuevaPassword,
} from '../src/lib/recuperacionPassword';

describe('tokens del enlace', () => {
  it('genera tokens distintos con el formato esperado', () => {
    const a = generarToken();
    const b = generarToken();
    expect(a).not.toBe(b);
    expect(formatoTokenValido(a)).toBe(true);
  });

  it('rechaza tokens con otro largo o caracteres raros', () => {
    expect(formatoTokenValido('')).toBe(false);
    expect(formatoTokenValido('abc')).toBe(false);
    expect(formatoTokenValido(`${'a'.repeat(42)}=`)).toBe(false);
    expect(formatoTokenValido(`${'a'.repeat(42)}' OR 1=1`)).toBe(false);
  });

  it('en la base se guarda el hash, nunca el token', () => {
    const token = generarToken();
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toBe(hashToken(token));
  });
});

describe('enlaceVigente', () => {
  const ahora = new Date('2026-11-11T12:00:00Z');

  it('sirve si no se ha usado y no ha vencido', () => {
    expect(enlaceVigente({ fecha_expiracion: new Date('2026-11-11T12:10:00Z'), fecha_uso: null }, ahora)).toBe(true);
  });

  it('no sirve si ya venció o ya se usó', () => {
    expect(enlaceVigente({ fecha_expiracion: new Date('2026-11-11T11:59:59Z'), fecha_uso: null }, ahora)).toBe(false);
    expect(enlaceVigente({ fecha_expiracion: ahora, fecha_uso: null }, ahora)).toBe(false);
    expect(enlaceVigente({ fecha_expiracion: new Date('2026-11-11T12:10:00Z'), fecha_uso: new Date('2026-11-11T11:00:00Z') }, ahora)).toBe(false);
  });
});

describe('validarNuevaPassword', () => {
  it('acepta una contraseña segura que coincide', () => {
    expect(() => validarNuevaPassword('Tenis2026!', 'Tenis2026!')).not.toThrow();
  });

  it('pide las mismas reglas que el registro', () => {
    expect(() => validarNuevaPassword('Ab1!', 'Ab1!')).toThrow(RecuperacionError);
    expect(() => validarNuevaPassword('tenis2026!', 'tenis2026!')).toThrow('mayúscula');
    expect(() => validarNuevaPassword('TenisTenis!', 'TenisTenis!')).toThrow('número');
    expect(() => validarNuevaPassword('Tenis20266', 'Tenis20266')).toThrow('símbolo');
  });

  it('rechaza si la confirmación no coincide', () => {
    expect(() => validarNuevaPassword('Tenis2026!', 'Tenis2026?')).toThrow('no coinciden');
  });
});
