import { assertAdminHost, assertSameOrigin } from '~/utils/request-guard';

export async function action({ request }: { request: Request }) {
  assertAdminHost(request);
  assertSameOrigin(request);
  const { createLogoutCookie } = await import('~/utils/server-auth');

  const cookie = createLogoutCookie();
  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': cookie,
      Location: '/login',
    },
  });
}
