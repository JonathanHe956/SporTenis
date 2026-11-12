import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import {
  RecuperacionError,
  SEGUNDOS_REENVIO,
  codigoVigente,
  segundosParaReenviar,
  solicitarRecuperacion,
  validarNuevaPassword,
} from '../src/lib/recuperacionPassword';
import { generarCodigo, hashCodigo } from '../src/lib/verificacionCorreo';

describe('código de recuperación', () => {
  it('es de 6 dígitos, como el del registro', () => {
    for (let i = 0; i < 50; i++) expect(generarCodigo()).toMatch(/^\d{6}$/);
  });

  it('en la base queda un hash ligado al token del navegador, nunca el código', () => {
    const token = 'a'.repeat(43);
    expect(hashCodigo('123456', token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCodigo('123456', token)).not.toContain('123456');
    // El mismo código con otra cookie no coincide
    expect(hashCodigo('123456', token)).not.toBe(hashCodigo('123456', 'b'.repeat(43)));
  });

  it('rechaza un correo inválido antes de consultar la base', async () => {
    await expect(solicitarRecuperacion({} as never, 'no-es-correo')).rejects.toThrow(RecuperacionError);
  });
});

describe('codigoVigente', () => {
  const ahora = new Date('2026-11-11T12:00:00Z');

  it('sirve si no se ha usado y no ha vencido', () => {
    expect(codigoVigente({ fecha_expiracion: new Date('2026-11-11T12:10:00Z'), fecha_uso: null }, ahora)).toBe(true);
  });

  it('no sirve si ya venció o ya se usó', () => {
    expect(codigoVigente({ fecha_expiracion: new Date('2026-11-11T11:59:59Z'), fecha_uso: null }, ahora)).toBe(false);
    expect(codigoVigente({ fecha_expiracion: ahora, fecha_uso: null }, ahora)).toBe(false);
    expect(codigoVigente({ fecha_expiracion: new Date('2026-11-11T12:10:00Z'), fecha_uso: new Date('2026-11-11T11:00:00Z') }, ahora)).toBe(false);
  });
});

describe('segundosParaReenviar', () => {
  const ahora = new Date('2026-11-11T12:00:00Z');

  it(`espera ${SEGUNDOS_REENVIO} segundos entre códigos`, () => {
    expect(segundosParaReenviar({ fecha_creacion: ahora }, ahora)).toBe(SEGUNDOS_REENVIO);
    expect(segundosParaReenviar({ fecha_creacion: new Date('2026-11-11T11:59:30Z') }, ahora)).toBe(30);
    expect(segundosParaReenviar({ fecha_creacion: new Date('2026-11-11T11:58:00Z') }, ahora)).toBe(0);
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
