import { describe, expect, it, vi } from 'vitest';

// Las funciones probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { enmascararCorreo, generarCodigo, hashCodigo, validarRegistro, VerificacionError } from '../src/lib/verificacionCorreo';

const formulario = (cambios: Record<string, string> = {}): FormData => {
  const form = new FormData();
  const datos = {
    nombre: 'Ana',
    apellidos: 'López Núñez',
    telefono: '5512345678',
    correo: ' Ana.Lopez@Correo.com ',
    password: 'Segura#123',
    confirmPassword: 'Segura#123',
    ...cambios,
  };
  for (const [campo, valor] of Object.entries(datos)) form.set(campo, valor);
  return form;
};

describe('generarCodigo', () => {
  it('siempre da 6 dígitos, con ceros a la izquierda si hace falta', () => {
    for (let i = 0; i < 200; i++) expect(generarCodigo()).toMatch(/^\d{6}$/);
  });
});

describe('hashCodigo', () => {
  it('depende del token: el mismo código con otra cookie no coincide', () => {
    expect(hashCodigo('123456', 'token-a')).toBe(hashCodigo('123456', 'token-a'));
    expect(hashCodigo('123456', 'token-a')).not.toBe(hashCodigo('123456', 'token-b'));
    expect(hashCodigo('123456', 'token-a')).not.toContain('123456');
  });
});

describe('enmascararCorreo', () => {
  it('deja ver solo el inicio del usuario y el dominio', () => {
    expect(enmascararCorreo('juanperez@gmail.com')).toBe('ju•••••••@gmail.com');
    expect(enmascararCorreo('al@x.mx')).toBe('a•••@x.mx');
  });
});

describe('validarRegistro', () => {
  it('normaliza el correo y une nombre y apellidos', () => {
    expect(validarRegistro(formulario())).toEqual({
      nombre: 'Ana López Núñez',
      telefono: '5512345678',
      correo: 'ana.lopez@correo.com',
      password: 'Segura#123',
    });
  });

  it.each([
    [{ nombre: 'Ana1' }, 'letras'],
    [{ telefono: '55123' }, '10 dígitos'],
    [{ correo: 'sin-arroba' }, 'correo válido'],
    [{ password: 'debil', confirmPassword: 'debil' }, '8+ caracteres'],
    [{ confirmPassword: 'Otra#1234' }, 'no coinciden'],
  ])('rechaza datos inválidos (%o)', (cambios, mensaje) => {
    expect(() => validarRegistro(formulario(cambios))).toThrow(VerificacionError);
    expect(() => validarRegistro(formulario(cambios))).toThrow(mensaje);
  });
});
