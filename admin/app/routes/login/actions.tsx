import {
  validateCredentials,
  createAuthToken,
  createAuthCookie,
} from '~/utils/server-auth';

export async function action({ request }: { request: Request }): Promise<any> {
  const formData = await request.formData();

  const username = formData.get('username') as string;
  const password = formData.get('password') as string;

  if (!username || !password) {
    return {
      error: 'Username and password are required',
    };
  }

  const isValid = await validateCredentials({ username, password });
  if (!isValid) {
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
