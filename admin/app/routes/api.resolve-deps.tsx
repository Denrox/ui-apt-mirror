import { requireAuthMiddleware } from '~/utils/auth-middleware';
import {
  closureOptionsError,
  resolveClosure,
  ResolveBusyError,
  ResolveTooLargeError,
  runResolveExclusive,
} from '~/lib/dep-closure';
import { UpstreamFetchError } from '~/lib/upstream-fetch';

const tokens = (v: FormDataEntryValue | null): string[] =>
  ((v as string) ?? '')
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);

export async function loader() {
  throw new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
}

/** Compute the dependency closure of seed packages against the upstream repo. */
export async function action({ request }: { request: Request }) {
  await requireAuthMiddleware(request);
  if (request.method !== 'POST') {
    throw new Response('Method not allowed', { status: 405 });
  }

  try {
    const fd = await request.formData();
    const baseUrl = ((fd.get('baseUrl') as string) ?? '').trim();
    const suite = (tokens(fd.get('suite'))[0] ?? '').trim();
    const components = tokens(fd.get('components'));
    const arches = tokens(fd.get('arches'));
    const seeds = tokens(fd.get('seeds'));
    const includeRecommends = fd.get('includeRecommends') === 'true';

    if (!baseUrl || !suite || !components.length || !seeds.length) {
      return Response.json(
        {
          error:
            'baseUrl, suite, components and at least one seed are required',
        },
        { status: 400 },
      );
    }

    const options = {
      baseUrl,
      suite,
      components,
      arches: arches.length ? arches : ['amd64'],
      seeds,
      includeRecommends,
    };
    const invalid = closureOptionsError(options);
    if (invalid) {
      return Response.json({ error: invalid }, { status: 400 });
    }

    const result = await runResolveExclusive(() => resolveClosure(options));

    if (result.indexSize === 0) {
      return Response.json(
        {
          error:
            'Could not read any package index — check the URL/suite/components.',
        },
        { status: 502 },
      );
    }

    return Response.json(result);
  } catch (error) {
    if (error instanceof ResolveBusyError) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    if (error instanceof ResolveTooLargeError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof UpstreamFetchError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    console.error('resolve-deps failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve' },
      { status: 500 },
    );
  }
}
