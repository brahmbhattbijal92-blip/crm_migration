import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '../../../src/lib/supabase/server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const requestedOtpType = request.nextUrl.searchParams.get('type');
  const otpTypes = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const;
  const otpType = otpTypes.find((candidate) => candidate === requestedOtpType);
  const requestedPath = request.nextUrl.searchParams.get('next');
  const nextPath = requestedPath?.startsWith('/') && !requestedPath.startsWith('//')
    ? requestedPath
    : '/dashboard';

  if (code || (tokenHash && otpType)) {
    const supabase = await createSupabaseServerClient();
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: otpType! });
    if (!error) {
      const destination = new URL(nextPath, request.url);
      if (destination.pathname === '/auth/complete') destination.searchParams.set('verified', '1');
      return NextResponse.redirect(destination);
    }
    console.error('Supabase auth callback verification failed:', { code: error.code, message: error.message });
  }

  const completionUrl = new URL('/auth/complete', request.url);
  completionUrl.searchParams.set('next', nextPath);
  return NextResponse.redirect(completionUrl);
}
