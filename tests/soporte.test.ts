import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { esCancelable, transicionPermitida } from '../src/lib/ordenes';
import {
  DIAS_DEVOLUCION,
  MAX_MENSAJE,
  SoporteError,
  folioTicket,
  motivoTipoNoPermitido,
  prioridadInicial,
  ticketActivo,
  tiposPermitidos,
  validarCalificacion,
  validarMensaje,
  validarNuevoTicket,
} from '../src/lib/soporte';

const ahora = new Date('2026-11-10T12:00:00');
const haceDias = (dias: number) => new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);

describe('motivoTipoNoPermitido', () => {
  it('pide el pedido en los motivos que se refieren a uno', () => {
    expect(motivoTipoNoPermitido('Retraso en la entrega', null, ahora)).toMatch(/Elige el pedido/);
    expect(motivoTipoNoPermitido('Cancelación', null, ahora)).toMatch(/Elige el pedido/);
    expect(motivoTipoNoPermitido('Pago o factura', null, ahora)).toBeNull();
    expect(motivoTipoNoPermitido('Otro', null, ahora)).toBeNull();
  });

  it('solo acepta retrasos y cancelaciones antes de la entrega', () => {
    for (const estado of ['Procesando', 'Confirmada']) {
      const pedido = { estado, fechaEntrega: null };
      expect(motivoTipoNoPermitido('Retraso en la entrega', pedido, ahora)).toBeNull();
      expect(motivoTipoNoPermitido('Cancelación', pedido, ahora)).toBeNull();
    }
    const entregado = { estado: 'Entregada', fechaEntrega: haceDias(1) };
    expect(motivoTipoNoPermitido('Retraso en la entrega', entregado, ahora)).toMatch(/ya se entregó/);
    expect(motivoTipoNoPermitido('Cancelación', entregado, ahora)).toMatch(/Cambio o devolución/);
    const cancelado = { estado: 'Cancelada', fechaEntrega: null };
    expect(motivoTipoNoPermitido('Retraso en la entrega', cancelado, ahora)).toMatch(/cancelado/);
    expect(motivoTipoNoPermitido('Cancelación', cancelado, ahora)).toMatch(/cancelado/);
  });

  it(`acepta daños y devoluciones solo los ${DIAS_DEVOLUCION} días posteriores a la entrega`, () => {
    expect(motivoTipoNoPermitido('Cambio o devolución', { estado: 'Confirmada', fechaEntrega: null }, ahora)).toMatch(/cuando el pedido se haya entregado/);
    expect(motivoTipoNoPermitido('Cambio o devolución', { estado: 'Entregada', fechaEntrega: haceDias(DIAS_DEVOLUCION) }, ahora)).toBeNull();
    expect(motivoTipoNoPermitido('Producto dañado o incorrecto', { estado: 'Entregada', fechaEntrega: haceDias(DIAS_DEVOLUCION + 1) }, ahora)).toMatch(/más de 30 días/);
  });
});

describe('tiposPermitidos', () => {
  it('ofrece lo que aplica a cada etapa del pedido', () => {
    expect(tiposPermitidos({ estado: 'Confirmada', fechaEntrega: null }, ahora)).toEqual([
      'Retraso en la entrega', 'Cancelación', 'Pago o factura', 'Otro',
    ]);
    expect(tiposPermitidos({ estado: 'Entregada', fechaEntrega: haceDias(3) }, ahora)).toEqual([
      'Producto dañado o incorrecto', 'Cambio o devolución', 'Pago o factura', 'Otro',
    ]);
    expect(tiposPermitidos(null, ahora)).toEqual(['Pago o factura', 'Otro']);
  });
});

describe('validarNuevoTicket', () => {
  it('limpia el asunto y genera uno si no se manda', () => {
    expect(validarNuevoTicket({ tipo: 'Cancelación', id_venta: '12', mensaje: '  Ya no lo necesito, gracias.  ' })).toEqual({
      tipo: 'Cancelación',
      asunto: 'Cancelación · Pedido #12',
      mensaje: 'Ya no lo necesito, gracias.',
      id_venta: 12,
    });
    expect(validarNuevoTicket({ tipo: 'Otro', asunto: '  Duda   de tallas ', mensaje: '¿Las tallas son de México?' }).asunto).toBe('Duda de tallas');
  });

  it('rechaza motivo, pedido o descripción inválidos', () => {
    expect(() => validarNuevoTicket({ tipo: 'Queja', mensaje: 'Una descripción larga' })).toThrow(SoporteError);
    expect(() => validarNuevoTicket({ tipo: 'Otro', id_venta: 'abc', mensaje: 'Una descripción larga' })).toThrow(/pedido no es válido/);
    expect(() => validarNuevoTicket({ tipo: 'Otro', mensaje: 'corto' })).toThrow(/al menos 10/);
    expect(() => validarNuevoTicket({ tipo: 'Otro', asunto: 'x'.repeat(151), mensaje: 'Una descripción larga' })).toThrow(/asunto/);
  });
});

describe('validarMensaje y validarCalificacion', () => {
  it('valida el largo del mensaje y conserva los saltos de línea', () => {
    expect(validarMensaje('Hola\r\n\r\nSigue sin llegar ')).toBe('Hola\n\nSigue sin llegar');
    expect(() => validarMensaje('   ')).toThrow(/vacío/);
    expect(() => validarMensaje('x'.repeat(MAX_MENSAJE + 1))).toThrow(/2000/);
  });

  it('acepta de 1 a 5 estrellas y comentario opcional', () => {
    expect(validarCalificacion({ calificacion: '4', comentario: '  Llegó rápido ' })).toEqual({ calificacion: 4, comentario: 'Llegó rápido' });
    expect(validarCalificacion({ calificacion: 1 })).toEqual({ calificacion: 1, comentario: null });
    for (const calificacion of [0, 6, 3.5, 'cinco', undefined]) {
      expect(() => validarCalificacion({ calificacion })).toThrow(/1 a 5/);
    }
  });
});

describe('reglas de tickets y órdenes', () => {
  it('da prioridad alta a lo urgente y formatea el folio', () => {
    expect(prioridadInicial('Retraso en la entrega')).toBe('Alta');
    expect(prioridadInicial('Cancelación')).toBe('Alta');
    expect(prioridadInicial('Cambio o devolución')).toBe('Media');
    expect(prioridadInicial('Otro')).toBe('Baja');
    expect(folioTicket(42)).toBe('TK-00042');
    expect(ticketActivo('En proceso')).toBe(true);
    expect(ticketActivo('Resuelto')).toBe(false);
  });

  it('permite cancelar solo antes de la entrega y avanzar de un paso a la vez', () => {
    expect(esCancelable('Procesando')).toBe(true);
    expect(esCancelable('Confirmada')).toBe(true);
    expect(esCancelable('Entregada')).toBe(false);
    expect(transicionPermitida('Confirmada', 'Cancelada')).toBe(true);
    expect(transicionPermitida('Entregada', 'Cancelada')).toBe(false);
    expect(transicionPermitida('Procesando', 'Entregada')).toBe(false);
    expect(transicionPermitida('Procesando', 'Confirmada')).toBe(true);
  });
});
