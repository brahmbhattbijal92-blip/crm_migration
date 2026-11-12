import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabasePublicConfig } from './src/lib/supabase/config';

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isDashboard = pathname.startsWith('/dashboard');
  const isLoginPage = pathname === '/login';
  const requiresAuthentication = isDashboard || pathname === '/setup';

  const config = getSupabasePublicConfig();
  if (!config) {
    if (!requiresAuthentication) return NextResponse.next({ request });
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('error', 'configuration');
    return NextResponse.redirect(loginUrl);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: userResult } = await supabase.auth.getUser();
  if (isLoginPage && userResult.user) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = '/dashboard';
    dashboardUrl.search = '';
    const redirectResponse = NextResponse.redirect(dashboardUrl);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  if (requiresAuthentication && !userResult.user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    const redirectResponse = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  if (requiresAuthentication && userResult.user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('default_organization_id')
      .eq('user_id', userResult.user.id)
      .maybeSingle();
    const organizationId = profile?.default_organization_id;
    let hasOrganizationAccess = false;

    if (organizationId) {
      const { data: membership } = await supabase
        .from('organization_memberships')
        .select('organization_id, role, removed_at')
        .eq('organization_id', organizationId)
        .eq('user_id', userResult.user.id)
        .maybeSingle();
      hasOrganizationAccess = Boolean(membership && membership.role !== 'inactive' && !membership.removed_at);
    }

    if (isDashboard && !hasOrganizationAccess) {
      const setupUrl = request.nextUrl.clone();
      setupUrl.pathname = '/setup';
      const redirectResponse = NextResponse.redirect(setupUrl);
      response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
      return redirectResponse;
    }

    if (pathname === '/setup' && hasOrganizationAccess) {
      const dashboardUrl = request.nextUrl.clone();
      dashboardUrl.pathname = '/dashboard';
      const redirectResponse = NextResponse.redirect(dashboardUrl);
      response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
      return redirectResponse;
    }
  }

  return response;
}

export const config = {
  matcher: ['/dashboard/:path*', '/setup', '/auth/:path*', '/login'],
};
