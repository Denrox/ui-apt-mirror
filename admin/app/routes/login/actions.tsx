import { data } from 'react-router';
import {
  attemptLogin,
  createAuthToken,
  createAuthCookie,
} from '~/utils/server-auth';
import { tooManyAttemptsMessage } from '~/utils/login-limiter';
import { assertAdminHost, assertSameOrigin } from '~/utils/request-guard';

export async function action({ request }: { request: Request }): Promise<any> {
  // No admin sessions on the public hosts, which also serve user uploads.
  assertAdminHost(request);
  // Another host on the site must not sign the browser in as someone else.
  assertSameOrigin(request);
  const formData = await request.formData();

  const username = formData.get('username') as string;
  const password = formData.get('password') as string;

  if (!username || !password) {
    return {
      error: 'Username and password are required',
    };
  }

  const { ok, retryAfter } = await attemptLogin(request, { username, password });
  if (retryAfter) {
    return data(
      { error: tooManyAttemptsMessage(retryAfter) },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }
  if (!ok) {
    return {
      error: 'Invalid username or password',
    };
  }

  const token = await createAuthToken(username);
  const cookie = createAuthCookie(token);
  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': cookie,
      Location: '/',
    },
  });
}
