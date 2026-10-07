import { describe, expect, it } from 'vitest';
import { hashPassword, isPasswordHash, verifyPassword } from '../src/lib/password';

describe('password', () => {
  it('genera un hash distinto cada vez y nunca guarda el texto original', async () => {
    const first = await hashPassword('password123');
    const second = await hashPassword('password123');

    expect(first).not.toBe(second);
    expect(first).not.toContain('password123');
    expect(isPasswordHash(first)).toBe(true);
  });

  it('acepta la contraseña correcta y rechaza la incorrecta', async () => {
    const hash = await hashPassword('s3creta!');

    expect(await verifyPassword('s3creta!', hash)).toBe(true);
    expect(await verifyPassword('s3creta', hash)).toBe(false);
  });

  it('sigue aceptando contraseñas heredadas en texto plano', async () => {
    expect(isPasswordHash('password123')).toBe(false);
    expect(await verifyPassword('password123', 'password123')).toBe(true);
    expect(await verifyPassword('otra', 'password123')).toBe(false);
  });

  it('rechaza un hash mal formado', async () => {
    expect(await verifyPassword('x', 'scrypt$')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$abcd$')).toBe(false);
  });
});
