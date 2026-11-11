import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { correoCuentaEliminada } from '../src/lib/avisosCorreo';
import { esCorreoEntregable } from '../src/lib/campanas';
import { correoEliminado, motivoParaNoEliminar, notificacionDevolucion } from '../src/lib/eliminarCuenta';
import { accionNotificacion } from '../src/lib/notificaciones';

const libre = { pedidosEnCurso: 0, pagosPendientes: 0 };

describe('motivoParaNoEliminar', () => {
  it('deja eliminar sin pedidos en curso ni pagos pendientes', () => {
    expect(motivoParaNoEliminar(libre)).toBeNull();
  });

  it('bloquea con pedidos en curso (singular y plural)', () => {
    expect(motivoParaNoEliminar({ ...libre, pedidosEnCurso: 1 })).toMatch(/un pedido en curso.*se entregue o lo canceles/);
    expect(motivoParaNoEliminar({ ...libre, pedidosEnCurso: 3 })).toMatch(/3 pedidos en curso.*se entreguen o los canceles/);
  });

  it('bloquea con un pago de Mercado Pago pendiente', () => {
    expect(motivoParaNoEliminar({ ...libre, pagosPendientes: 1 })).toMatch(/Mercado Pago/);
  });
});

describe('correoEliminado', () => {
  it('usa un dominio reservado que nunca recibe correo', () => {
    expect(correoEliminado(42)).toBe('eliminado-42@sportenis.invalid');
    expect(esCorreoEntregable(correoEliminado(42))).toBe(false);
  });
});

describe('devolución del saldo', () => {
  const cliente = { nombre: 'Ana <López>', correo: 'ana@gmail.com' };

  it('avisa al administrador cuánto devolver y a quién, con enlace al cliente', () => {
    const n = notificacionDevolucion(21, cliente, 150.5);
    expect(n.tipo).toBe('devolucion_monedero');
    expect(n.titulo).toContain('$150.50');
    expect(n.mensaje).toContain('ana@gmail.com');
    expect(accionNotificacion(n, 'administrador')).toEqual({ enlace: '/crm/clientes/21', texto: 'Ver cliente' });
  });

  it('el correo de confirmación dice el saldo a devolver y no remite a una cuenta que ya no existe', () => {
    const correo = correoCuentaEliminada(cliente, 150.5);
    expect(correo.para).toBe('ana@gmail.com');
    expect(correo.asunto).toContain('$150.50');
    expect(correo.html).toContain('<strong>$150.50</strong> en tu monedero');
    expect(correo.html).toContain('Hola, Ana:');
    expect(correo.html).not.toContain('/cuenta/soporte');
    expect(correo.texto).toContain('$150.50');
  });

  it('sin saldo no menciona el monedero', () => {
    const correo = correoCuentaEliminada(cliente, 0);
    expect(correo.asunto).toBe('Eliminamos tu cuenta de SporTenis');
    expect(correo.html).not.toContain('monedero');
  });
});
