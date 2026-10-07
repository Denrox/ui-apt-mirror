import { assertAdminHost, assertSameOrigin } from '~/utils/request-guard';

export async function action({ request }: { request: Request }) {
  assertAdminHost(request);
  assertSameOrigin(request);
  const { createLogoutCookie, revokeSession } = await import('~/utils/server-auth');
  try {
    await revokeSession(request);
  } catch (error) {
    console.error('Error revoking session on logout:', error);
  }

  const cookie = createLogoutCookie();
  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': cookie,
      Location: '/login',
    },
  });
}
