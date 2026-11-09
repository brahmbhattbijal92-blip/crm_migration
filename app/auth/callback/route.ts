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
    if (!error) return NextResponse.redirect(new URL(nextPath, request.url));
    console.error('Supabase auth callback verification failed:', { code: error.code, message: error.message });
  }

  return NextResponse.redirect(new URL('/login?error=confirmation', request.url));
}
