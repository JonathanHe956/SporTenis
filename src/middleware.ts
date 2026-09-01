import { defineMiddleware } from 'astro:middleware';
import { db, Usuarios, eq } from 'astro:db';

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;

  // Rutas que requieren autenticación
  const isCrmRoute = pathname.startsWith('/crm');
  const isAccountRoute = pathname.startsWith('/cuenta');

  if (isCrmRoute || isAccountRoute) {
    const sessionId = context.cookies.get('sportenis_session')?.value;

    if (!sessionId) {
      return context.redirect('/login');
    }

    // Validar usuario y rol en BD
    try {
      const userResult = await db.select().from(Usuarios).where(eq(Usuarios.id, Number(sessionId)));
      
      if (userResult.length === 0) {
        // Sesión inválida, limpiar cookie
        context.cookies.delete('sportenis_session', { path: '/' });
        return context.redirect('/login');
      }

      const user = userResult[0];

      // Reglas de autorización para el CRM
      if (isCrmRoute) {
        // Solo rol 1 (Admin) y rol 2 (Vendedor) pueden entrar al CRM
        if (user.id_rol !== 1 && user.id_rol !== 2) {
          // Si es un cliente normal tratando de entrar al CRM, lo mandamos a su panel
          return context.redirect('/cuenta');
        }
      }
    } catch (e) {
      console.error("Error en middleware de autenticación:", e);
      return context.redirect('/login');
    }
  }

  // Dejar que la petición continúe normalmente
  return next();
});
