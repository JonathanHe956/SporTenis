import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const PREFIX = 'scrypt';
const KEY_LENGTH = 32;

export const isPasswordHash = (stored: string): boolean => stored.startsWith(`${PREFIX}$`);

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `${PREFIX}$${salt.toString('hex')}$${key.toString('hex')}`;
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  if (!isPasswordHash(stored)) {
    // Contraseñas heredadas en texto plano: se aceptan y el login las rehashea.
    const given = Buffer.from(password);
    const expected = Buffer.from(stored);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  const [, saltHex, keyHex] = stored.split('$');
  if (!saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, 'hex');
  if (expected.length === 0) return false;
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(key, expected);
};
