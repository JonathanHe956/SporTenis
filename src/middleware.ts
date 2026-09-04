import { defineMiddleware } from 'astro:middleware';
import { canAccessCrm, getAuthenticatedUser } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;

  // Rutas que requieren autenticación
  const isCrmRoute = pathname.startsWith('/crm');
  const isAccountRoute = pathname.startsWith('/cuenta');

  context.locals.user = null;
  const sessionId = context.cookies.get('sportenis_session')?.value;

  if (sessionId) {
    try {
      context.locals.user = await getAuthenticatedUser(sessionId);
      if (!context.locals.user) context.cookies.delete('sportenis_session', { path: '/' });
    } catch (error: unknown) {
      console.error('Error en middleware de autenticación:', error);
      context.locals.user = null;
    }
  }

  if (isCrmRoute || isAccountRoute) {
    if (!context.locals.user) return context.redirect('/login');
    if (isCrmRoute && !canAccessCrm(context.locals.user.role)) {
      return context.redirect('/');
    }
  }

  // Dejar que la petición continúe normalmente
  return next();
});
