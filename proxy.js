import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { supabaseUrl, supabaseKey } from './lib/supabase/env';

const protectedPaths = ['/profile', '/onboarding'];

// Refreshes the Supabase session cookie on each request and keeps signed-out visitors off protected routes.
export async function proxy(request) {
  let response = NextResponse.next({ request });
  if (!supabaseUrl || !supabaseKey) return response;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const { pathname } = request.nextUrl;
  if (!data?.claims && protectedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    const redirect = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
