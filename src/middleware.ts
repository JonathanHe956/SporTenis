import { defineMiddleware } from 'astro:middleware';
import { canAccessCrm, canAccessScm, getAuthenticatedUser } from './lib/auth';
import { SESSION_COOKIE } from './lib/session';

const startsWithSegment = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

// Endpoints que solo usa el panel interno (CRM / SCM)
const staffApiRoutes = ['/api/check-stock', '/api/notificaciones'];

const jsonError = (status: number, error: string): Response =>
  new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;

  // Rutas que requieren autenticación
  const isCrmRoute = startsWithSegment(pathname, '/crm');
  const isScmRoute = startsWithSegment(pathname, '/scm');
  const isAccountRoute = startsWithSegment(pathname, '/cuenta');
  const isStaffApiRoute = staffApiRoutes.some((route) => startsWithSegment(pathname, route));

  context.locals.user = null;
  const sessionToken = context.cookies.get(SESSION_COOKIE)?.value;

  if (sessionToken) {
    try {
      context.locals.user = await getAuthenticatedUser(sessionToken);
      if (!context.locals.user) context.cookies.delete(SESSION_COOKIE, { path: '/' });
    } catch (error: unknown) {
      console.error('Error en middleware de autenticación:', error);
      context.locals.user = null;
    }
  }

  const user = context.locals.user;

  if (isStaffApiRoute) {
    if (!user) return jsonError(401, 'No autorizado');
    if (!canAccessCrm(user.role) && !canAccessScm(user.role)) return jsonError(403, 'Sin permisos');
  }

  if (isCrmRoute || isScmRoute || isAccountRoute) {
    if (!user) return context.redirect('/login');
    if (isCrmRoute && !canAccessCrm(user.role)) {
      return context.redirect(canAccessScm(user.role) ? '/scm' : '/');
    }
    if (isScmRoute && !canAccessScm(user.role)) {
      return context.redirect(canAccessCrm(user.role) ? '/crm' : '/');
    }
  }

  // Dejar que la petición continúe normalmente
  return next();
});
