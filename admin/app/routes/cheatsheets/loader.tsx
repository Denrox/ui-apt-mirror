import { redirect } from 'react-router';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import {
  categoryCounts,
  isPublicCheatsheetsRequest,
  listSources,
} from '~/lib/cheatsheets-store';

export interface SourceView {
  id: string;
  name: string;
  fileCount: number;
  categories: { name: string; count: number }[];
  // Admin only:
  url?: string;
  ref?: string | null;
  path?: string;
  status?: 'downloading' | 'ready' | 'error';
  error?: string | null;
  revision?: string | null;
  updatedAt?: string | null;
}

export async function loader({ request }: { request: Request }) {
  const isPublic = isPublicCheatsheetsRequest(request);
  // The public host shows cheatsheets at /, without the admin shell around /cheatsheets.
  if (isPublic && new URL(request.url).pathname !== '/') {
    throw redirect('/');
  }
  if (!isPublic) {
    await requireAuthMiddleware(request);
  }

  try {
    const sources = await listSources();
    const views: SourceView[] = [];
    for (const s of sources) {
      if (isPublic && s.fileCount === 0) continue;
      const base = {
        id: s.id,
        name: s.name,
        fileCount: s.fileCount,
        categories: await categoryCounts(s.id),
      };
      views.push(
        isPublic
          ? base
          : {
              ...base,
              url: s.url,
              ref: s.ref,
              path: s.path,
              status: s.status,
              error: s.error,
              revision: s.revision,
              updatedAt: s.updatedAt,
            },
      );
    }
    return { sources: views, isPublic, error: null as string | null };
  } catch (error) {
    console.error('Error loading cheatsheets:', error);
    return { sources: [] as SourceView[], isPublic, error: 'Failed to load cheatsheets' };
  }
}
