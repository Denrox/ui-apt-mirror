import { requireAuthMiddleware } from '~/utils/auth-middleware';
import { addSource, refreshSource, removeSource } from '~/lib/cheatsheets-store';

export async function action({ request }: { request: Request }) {
  await requireAuthMiddleware(request);

  if (request.method !== 'POST') {
    throw new Response('Method not allowed', { status: 405 });
  }

  const formData = await request.formData();
  const intent = String(formData.get('intent') ?? '');
  const id = String(formData.get('id') ?? '');

  try {
    switch (intent) {
      case 'addSource': {
        const source = await addSource(
          String(formData.get('url') ?? ''),
          String(formData.get('name') ?? ''),
        );
        return { success: true, intent, message: `Downloading "${source.name}"…` };
      }
      case 'refreshSource':
        await refreshSource(id);
        return { success: true, intent, message: 'Update started' };
      case 'removeSource':
        await removeSource(id);
        return { success: true, intent, message: 'Source removed' };
      default:
        return { success: false, intent, error: 'Invalid intent' };
    }
  } catch (error) {
    return {
      success: false,
      intent,
      error: error instanceof Error ? error.message : 'Failed to process request',
    };
  }
}
