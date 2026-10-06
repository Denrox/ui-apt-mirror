import { requireAuthMiddleware } from '~/utils/auth-middleware';
import { isPublicCheatsheetsRequest, readPage } from '~/lib/cheatsheets-store';

export async function loader({ request }: { request: Request }) {
  if (!isPublicCheatsheetsRequest(request)) {
    await requireAuthMiddleware(request);
  }

  const url = new URL(request.url);
  const content = await readPage(
    url.searchParams.get('source') ?? '',
    url.searchParams.get('path') ?? '',
  );
  if (content === null) {
    throw new Response('Cheatsheet not found', { status: 404 });
  }
  return new Response(content, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
