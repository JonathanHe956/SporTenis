import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { canAccessRoute } from '../src/lib/auth';
import { accionNotificacion } from '../src/lib/notificaciones';
import { TIPOS_TICKET, esTicketLogistica } from '../src/lib/soporte';

describe('tickets de logística', () => {
  it('son los de envío y devoluciones; cancelación, pago y otro se quedan en el CRM', () => {
    expect(TIPOS_TICKET.filter(esTicketLogistica)).toEqual(['Retraso en la entrega', 'Producto dañado o incorrecto', 'Cambio o devolución']);
  });

  it('logística abre su bandeja del SCM pero no la del CRM; ventas al revés', () => {
    expect(canAccessRoute('logistica', '/scm/tickets')).toBe(true);
    expect(canAccessRoute('logistica', '/scm/tickets/12')).toBe(true);
    expect(canAccessRoute('logistica', '/crm/tickets')).toBe(false);
    expect(canAccessRoute('vendedor', '/crm/tickets/12')).toBe(true);
    expect(canAccessRoute('vendedor', '/scm/tickets')).toBe(false);
    expect(canAccessRoute('administrador', '/scm/tickets')).toBe(true);
    expect(canAccessRoute('cliente', '/scm/tickets')).toBe(false);
  });

  it('el botón de la notificación abre el ticket en la bandeja de cada rol', () => {
    const n = { tipo: 'ticket_logistica_nuevo', titulo: '🎫 Nuevo ticket TK-00012 · prioridad alta' };
    expect(accionNotificacion(n, 'logistica')?.enlace).toBe('/scm/tickets/12');
    expect(accionNotificacion(n, 'administrador')?.enlace).toBe('/crm/tickets/12');
    expect(accionNotificacion(n, 'vendedor')?.enlace).toBe('/crm/tickets/12');
  });
});
