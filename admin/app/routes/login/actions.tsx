import { validateCredentials, createAuthToken, createAuthCookie } from '~/utils/server-auth';

export async function action({ request }: { request: Request }) {
  console.log('Login action called');
  console.log('Request method:', request.method);
  console.log('Request URL:', request.url);
  console.log('Request headers:', Object.fromEntries(request.headers.entries()));
  
  const formData = await request.formData();
  console.log('FormData entries:', Array.from(formData.entries()));
  
  const username = formData.get('username') as string;
  const password = formData.get('password') as string;

  console.log('Form data received:', {
    username,
    password: password ? '***' : 'empty',
  });

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
