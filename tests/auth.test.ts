import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { canAccessCrm, canAccessErp, canAccessRoute, canAccessScm, canEditCatalogo, homeForRole, roleFromName } from '../src/lib/auth';

describe('roleFromName', () => {
  it('reconoce los nombres de la tabla Roles sin importar mayúsculas ni acentos', () => {
    expect(roleFromName('administrador')).toBe('administrador');
    expect(roleFromName('Logística')).toBe('logistica');
    expect(roleFromName(' VENDEDOR ')).toBe('vendedor');
    expect(roleFromName('Ventas')).toBe('vendedor');
    expect(roleFromName('cliente')).toBe('cliente');
  });

  it('no asigna rol a un nombre desconocido', () => {
    expect(roleFromName('gerente')).toBeUndefined();
    expect(roleFromName(null)).toBeUndefined();
  });
});

describe('acceso por rol', () => {
  it('administrador entra a ambos módulos', () => {
    expect(canAccessCrm('administrador')).toBe(true);
    expect(canAccessScm('administrador')).toBe(true);
  });

  it('vendedor solo entra al CRM y logística solo al SCM', () => {
    expect([canAccessCrm('vendedor'), canAccessScm('vendedor')]).toEqual([true, false]);
    expect([canAccessCrm('logistica'), canAccessScm('logistica')]).toEqual([false, true]);
  });

  it('cliente no entra a ningún panel', () => {
    expect([canAccessCrm('cliente'), canAccessScm('cliente')]).toEqual([false, false]);
  });

  it('cada rol aterriza en su módulo al iniciar sesión', () => {
    expect(homeForRole('administrador')).toBe('/crm');
    expect(homeForRole('vendedor')).toBe('/crm');
    expect(homeForRole('logistica')).toBe('/scm');
    expect(homeForRole('cliente')).toBe('/');
  });

  it('el personal interno accede al ERP y el cliente no', () => {
    expect(canAccessErp('administrador')).toBe(true);
    expect(canAccessErp('logistica')).toBe(true);
    expect(canAccessErp('vendedor')).toBe(true);
    expect(canAccessErp('cliente')).toBe(false);
  });

  it('la matriz completa de acceso es consistente', () => {
    //                        CRM     SCM     ERP
    const expected: Record<string, [boolean, boolean, boolean]> = {
      administrador:         [true,  true,  true],
      vendedor:              [true,  false, true],
      logistica:             [false, true,  true],
      cliente:               [false, false, false],
    };

    for (const [role, [crm, scm, erp]] of Object.entries(expected)) {
      expect(canAccessCrm(role as any)).toBe(crm);
      expect(canAccessScm(role as any)).toBe(scm);
      expect(canAccessErp(role as any)).toBe(erp);
    }
  });
});

describe('permiso por página', () => {
  it('ventas entra a clientes, órdenes y reportes, y del SCM solo consulta productos', () => {
    for (const path of ['/crm', '/crm/clientes/3', '/crm/actividad', '/erp', '/erp/ordenes', '/erp/ventas', '/erp/reportes', '/scm/productos']) {
      expect(canAccessRoute('vendedor', path), path).toBe(true);
    }
    for (const path of ['/scm', '/scm/pedidos', '/scm/proveedores', '/scm/actividad', '/scm/productosx']) {
      expect(canAccessRoute('vendedor', path), path).toBe(false);
    }
    expect(canEditCatalogo('vendedor')).toBe(false);
  });

  it('logística entra a SCM, órdenes y reportes, pero no al CRM', () => {
    for (const path of ['/scm', '/scm/productos', '/scm/pedidos', '/erp/ordenes', '/erp/reportes']) {
      expect(canAccessRoute('logistica', path), path).toBe(true);
    }
    expect(canAccessRoute('logistica', '/crm/clientes')).toBe(false);
    expect(canEditCatalogo('logistica')).toBe(true);
  });

  it('finanzas, nivel ERP, usuarios y configuración son solo del administrador', () => {
    const paths = ['/erp/finanzas', '/erp/implementacion', '/crm/usuarios', '/scm/configuracion', '/erp/usuarios/'];
    for (const path of paths) {
      expect(canAccessRoute('administrador', path), path).toBe(true);
      expect(canAccessRoute('vendedor', path), path).toBe(false);
      expect(canAccessRoute('logistica', path), path).toBe(false);
    }
  });

  it('el cliente y los visitantes no abren ninguna página del panel', () => {
    for (const path of ['/crm', '/scm/productos', '/erp/ordenes']) {
      expect(canAccessRoute('cliente', path), path).toBe(false);
      expect(canAccessRoute(null, path), path).toBe(false);
    }
    expect(canAccessRoute('cliente', '/carrito')).toBe(true);
  });
});
