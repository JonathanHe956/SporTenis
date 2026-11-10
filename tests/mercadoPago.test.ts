import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { fechaConZona, firmaWebhookValida } from '../src/lib/mercadoPago';

const secreto = 'secreto-de-prueba';
const firmar = (plantilla: string) => createHmac('sha256', secreto).update(plantilla).digest('hex');

describe('firmaWebhookValida', () => {
  it('acepta un aviso firmado con el secreto de la aplicación', () => {
    const v1 = firmar('id:123456;request-id:abc-1;ts:1700000000;');
    expect(firmaWebhookValida(`ts=1700000000,v1=${v1}`, 'abc-1', '123456', secreto)).toBe(true);
  });

  it('rechaza firmas alteradas, de otro pago o sin firma', () => {
    const v1 = firmar('id:123456;request-id:abc-1;ts:1700000000;');
    expect(firmaWebhookValida(`ts=1700000000,v1=${v1}`, 'abc-1', '999999', secreto)).toBe(false);
    expect(firmaWebhookValida(`ts=1700000001,v1=${v1}`, 'abc-1', '123456', secreto)).toBe(false);
    expect(firmaWebhookValida(`ts=1700000000,v1=${v1.replace(/.$/, '0')}`, 'abc-1', '123456', 'otro')).toBe(false);
    expect(firmaWebhookValida(null, 'abc-1', '123456', secreto)).toBe(false);
    expect(firmaWebhookValida('v1=abc', 'abc-1', '123456', secreto)).toBe(false);
  });

  it('sin x-request-id la plantilla lo omite, como indica Mercado Pago', () => {
    const v1 = firmar('id:123456;ts:1700000000;');
    expect(firmaWebhookValida(`ts=1700000000,v1=${v1}`, null, '123456', secreto)).toBe(true);
  });
});

describe('fechaConZona', () => {
  it('manda la hora local con su zona horaria explícita, como la pide Mercado Pago', () => {
    const fecha = new Date('2026-11-11T00:36:17.826Z');
    const texto = fechaConZona(fecha);
    expect(texto).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000[+-]\d{2}:\d{2}$/);
    // Es el mismo instante (sin milisegundos), no una hora corrida
    expect(new Date(texto).getTime()).toBe(Math.floor(fecha.getTime() / 1000) * 1000);
  });
});
