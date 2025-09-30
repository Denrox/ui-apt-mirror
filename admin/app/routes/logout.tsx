export async function action() {
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
