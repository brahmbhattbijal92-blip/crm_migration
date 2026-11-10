const APP_ORIGIN = 'https://crm-migration.local';
const DEFAULT_POST_LOGIN_PATH = '/dashboard';
const TEAM_PATH = '/dashboard/team';

export function getPostLoginPath(requestedPath: string | null): string {
  if (!requestedPath?.startsWith('/') || requestedPath.startsWith('//')) {
    return DEFAULT_POST_LOGIN_PATH;
  }

  try {
    const destination = new URL(requestedPath, APP_ORIGIN);
    if (destination.origin !== APP_ORIGIN) return DEFAULT_POST_LOGIN_PATH;
    if (destination.pathname === TEAM_PATH || destination.pathname.startsWith(`${TEAM_PATH}/`)) {
      return DEFAULT_POST_LOGIN_PATH;
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return DEFAULT_POST_LOGIN_PATH;
  }
}
