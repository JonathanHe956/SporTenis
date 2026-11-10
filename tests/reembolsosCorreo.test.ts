import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { correoPedido } from '../src/lib/avisosCorreo';
import type { CompraDetalle } from '../src/lib/compras';
import { enviarEnSegundoPlano, escaparHtml, parrafoSeguro, plantillaCorreo } from '../src/lib/correo';
import { describirReembolso } from '../src/lib/reembolsos';

describe('describirReembolso', () => {
  it('regresa al monedero lo que se pagó con el monedero', () => {
    const r = describirReembolso({ metodo: 'Monedero', referencia: null, monto: 1499, cobrado: true });
    expect(r.tipo).toBe('monedero');
    expect(r.monto).toBe(1499);
    expect(r.mensaje).toMatch(/monedero/);
    expect(r.mensaje).toContain('1,499.00');
  });

  it('dice a qué tarjeta va el reembolso (marca y últimos 4)', () => {
    const r = describirReembolso({ metodo: 'Tarjeta de crédito', referencia: 'Visa •••• 4242', monto: 2500, cobrado: true });
    expect(r.tipo).toBe('tarjeta');
    expect(r.mensaje).toContain('tu tarjeta Visa •••• 4242');
    expect(r.mensaje).toMatch(/días hábiles/);
    expect(describirReembolso({ metodo: 'Tarjeta de débito', referencia: null, monto: 10, cobrado: true }).mensaje)
      .toContain('la tarjeta con la que pagaste');
  });

  it('distingue Mercado Pago, otros métodos y pedidos que no se cobraron', () => {
    expect(describirReembolso({ metodo: 'Mercado Pago', referencia: 'Mercado Pago #123', monto: 900, cobrado: true }).tipo).toBe('mercado_pago');
    const efectivo = describirReembolso({ metodo: 'Efectivo', referencia: null, monto: 300, cobrado: true });
    expect(efectivo.tipo).toBe('otro');
    expect(efectivo.mensaje).toContain('(Efectivo)');
    const sinCargo = describirReembolso({ metodo: 'Monedero', referencia: null, monto: 500, cobrado: false });
    expect(sinCargo).toMatchObject({ tipo: 'sin_cargo', monto: 0 });
  });
});

describe('plantilla de correo', () => {
  it('escapa lo que escribe el usuario', () => {
    expect(escaparHtml('<script>alert("x")</script> & \'y\'')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
    expect(parrafoSeguro('Calle 1\n<b>Col.</b>')).toBe('Calle 1<br>&lt;b&gt;Col.&lt;/b&gt;');
    const html = plantillaCorreo({ titulo: 'Hola <Ana>', saludo: 'Hola, <img src=x>', contenidoHtml: '<p>ok</p>' });
    expect(html).toContain('Hola &lt;Ana&gt;');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('<p>ok</p>');
  });

  it('un correo que falla no lanza error a quien lo pidió', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => enviarEnSegundoPlano('prueba', async () => { throw new Error('SMTP caído'); })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consola).toHaveBeenCalledWith('[correo] No se pudo enviar "prueba":', expect.any(Error));
    consola.mockRestore();
  });
});

describe('correoPedido', () => {
  const compra: CompraDetalle = {
    id: 7,
    fecha: new Date('2026-11-01T10:00:00'),
    estado: 'Cancelada',
    fechaEntrega: null,
    cupon: null,
    metodoPago: 'Tarjeta de crédito',
    subtotal: 2499,
    envio: 0,
    total: 2499,
    direccionEnvio: 'Ana López · 5512345678\nAv. Reforma 123',
    baseSinImpuestos: 2154.31,
    impuestos: [],
    articulos: [{
      id_producto: 1, sku: 'RAQ-1', nombre: 'Raqueta <Pro>', categoria: 'Tenis', variante: 'Negro', imagen: null, tema: null,
      cantidad: 1, precioUnitario: 2499, subtotal: 2499,
    }],
    pago: { estado: 'Reembolsado', monto: 2499, fecha: new Date(), referencia: 'Visa •••• 4242' },
    factura: { folio: 'FAC-000007', uuid: 'x', estado: 'Cancelada', fechaEmision: new Date() },
    historial: [],
  };

  it('el correo de cancelación dice a dónde regresa el dinero', () => {
    const reembolso = describirReembolso({ metodo: compra.metodoPago, referencia: 'Visa •••• 4242', monto: 2499, cobrado: true });
    const correo = correoPedido('cancelado', compra, { nombre: 'Ana López', correo: 'ana@example.com' }, reembolso);
    expect(correo.para).toBe('ana@example.com');
    expect(correo.asunto).toBe('Tu pedido FAC-000007 fue cancelado');
    expect(correo.html).toContain('tu tarjeta Visa •••• 4242');
    expect(correo.html).toContain('Raqueta &lt;Pro&gt;');
    expect(correo.texto).toContain('Hola, Ana:');
    expect(correo.texto).toContain('/cuenta/compras/7');
  });

  it('el correo de confirmación lleva artículos, pago y dirección', () => {
    const correo = correoPedido('confirmado', { ...compra, estado: 'Confirmada' }, { nombre: 'Ana', correo: 'ana@example.com' });
    expect(correo.asunto).toContain('¡Gracias por tu compra!');
    expect(correo.html).toContain('Tarjeta de crédito (Visa •••• 4242)');
    expect(correo.html).toContain('Av. Reforma 123');
  });
});
