import { describe, expect, it, vi } from 'vitest';

// Las reglas probadas son puras: se evita abrir el pool de MySQL
vi.mock('../src/db/db', () => ({ db: {} }));

import { canAccessCrm, canAccessScm, homeForRole, roleFromName } from '../src/lib/auth';

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
});
