import { extractAuthToken, validateAuthToken } from '~/utils/server-auth';
import { assertAdminHost } from '~/utils/request-guard';

export async function loader({ request }: { request: Request }) {
  assertAdminHost(request);
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
