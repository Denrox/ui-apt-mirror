import { action as fileManagerAction } from './file-manager/action';
import type { Route } from './+types/api.upload-chunk';

// The file manager's upload intent as JSON, so the uploader can see a refused chunk.
export async function action({ request, params, context }: Route.ActionArgs) {
  const result = await fileManagerAction({ request, params, context } as any);
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
}
