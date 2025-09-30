import { extractAuthToken, validateAuthToken } from '~/utils/server-auth';

export async function loader({ request }: { request: Request }) {
  const cookieHeader = request.headers.get('Cookie');
  const token = extractAuthToken(cookieHeader);

  if (token) {
    const user = await validateAuthToken(token);
    if (user) {
      throw new Response(null, {
        status: 302,
        headers: {
          Location: '/',
        },
      });
    }
  }

  return null;
}
