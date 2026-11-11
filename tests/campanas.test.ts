import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { canAccessRoute } from '../src/lib/auth';
import { CampanaError, correoCampana, descuentoPromocion, esCorreoEntregable, ocultarCorreo, validarCampana } from '../src/lib/campanas';
import type { Promocion } from '../src/lib/promociones';

const formulario = (campos: Record<string, string>): FormData => {
  const form = new FormData();
  for (const [k, v] of Object.entries(campos)) form.set(k, v);
  return form;
};

const base = { asunto: 'Buen Fin', titulo: '¡Llegó el Buen Fin!', mensaje: 'Primer párrafo.\r\n\r\nSegundo <b>párrafo</b>.' };

describe('validarCampana', () => {
  it('pide asunto, título y mensaje', () => {
    expect(() => validarCampana(formulario({ ...base, asunto: '  ' }))).toThrow(CampanaError);
    expect(() => validarCampana(formulario({ ...base, titulo: '' }))).toThrow(/título/);
    expect(() => validarCampana(formulario({ ...base, mensaje: '' }))).toThrow(/mensaje/);
  });

  it('sin botón ni promoción los deja vacíos y normaliza los saltos de línea', () => {
    const datos = validarCampana(formulario(base));
    expect(datos).toMatchObject({ asunto: 'Buen Fin', idPromocion: null, boton: null });
    expect(datos.mensaje).toBe('Primer párrafo.\n\nSegundo <b>párrafo</b>.');
  });

  it('completa el botón y solo acepta enlaces http(s)', () => {
    expect(validarCampana(formulario({ ...base, boton_texto: 'Comprar' })).boton).toEqual({ texto: 'Comprar', url: 'http://localhost:4321/' });
    expect(validarCampana(formulario({ ...base, boton_url: 'https://tienda.mx/ofertas' })).boton).toEqual({ texto: 'Ver en la tienda', url: 'https://tienda.mx/ofertas' });
    expect(() => validarCampana(formulario({ ...base, boton_url: 'javascript:alert(1)' }))).toThrow(/https/);
    expect(() => validarCampana(formulario({ ...base, boton_url: 'no es url' }))).toThrow(/https/);
  });

  it('lee la promoción elegida', () => {
    expect(validarCampana(formulario({ ...base, promocion: '3' })).idPromocion).toBe(3);
    expect(() => validarCampana(formulario({ ...base, promocion: 'abc' }))).toThrow(/promoción/);
  });
});

describe('esCorreoEntregable', () => {
  it('salta los dominios reservados de los datos de prueba', () => {
    expect(esCorreoEntregable('ana@gmail.com')).toBe(true);
    expect(esCorreoEntregable('ana@sportenis.test')).toBe(false);
    expect(esCorreoEntregable('ana@tienda.local')).toBe(false);
    expect(esCorreoEntregable('ana@example.com')).toBe(false);
    expect(esCorreoEntregable('no-es-correo')).toBe(false);
  });
});

describe('correoCampana', () => {
  const promo: Promocion = {
    id: 1, nombre: 'Buen Fin', descripcion: 'En toda la tienda', tipo_descuento: 'porcentaje', valor: 20,
    fecha_inicio: new Date(2026, 10, 13), fecha_fin: new Date(2026, 10, 17, 23, 59), estado: 'Activa', productos: [], vigencia: 'Vigente',
  };
  const datos = validarCampana(formulario(base));
  const correo = correoCampana(datos, promo, { nombre: 'Ana <López>', correo: 'ana@gmail.com' }, 'http://localhost:4321/baja?t=abc');

  it('saluda al cliente, separa párrafos y escapa lo escrito', () => {
    expect(correo.para).toBe('ana@gmail.com');
    expect(correo.asunto).toBe('Buen Fin');
    expect(correo.html).toContain('Hola, Ana:');
    expect(correo.html).toContain('Primer párrafo.</p>');
    expect(correo.html).toContain('Segundo &lt;b&gt;párrafo&lt;/b&gt;.');
    expect(correo.html).not.toContain('<b>párrafo</b>');
  });

  it('destaca la promoción y trae el enlace de baja', () => {
    expect(correo.html).toContain('20% de descuento');
    expect(correo.html).toContain('Válida del 13 de noviembre al 17 de noviembre');
    expect(correo.html).toContain('href="http://localhost:4321/baja?t=abc"');
    expect(correo.texto).toContain('http://localhost:4321/baja?t=abc');
    expect(correo.encabezados).toEqual({ 'List-Unsubscribe': '<http://localhost:4321/baja?t=abc>' });
  });

  it('describe descuentos en pesos', () => {
    expect(descuentoPromocion({ tipo_descuento: 'monto', valor: 200 })).toBe('$200.00 de descuento');
  });
});

describe('campañas', () => {
  it('solo el administrador entra a /crm/campanas', () => {
    expect(canAccessRoute('administrador', '/crm/campanas')).toBe(true);
    expect(canAccessRoute('vendedor', '/crm/campanas')).toBe(false);
    expect(canAccessRoute('vendedor', '/crm/tickets')).toBe(true);
  });

  it('oculta el correo en la página de baja', () => {
    expect(ocultarCorreo('jona.hernandez@gmail.com')).toBe('jo•••@gmail.com');
  });
});
