import { requireAuthMiddleware } from '~/utils/auth-middleware';
import {
  listRepos,
  listPackages,
  sourcesSnippet,
  type LocalRepo,
  type LocalRepoPackage,
} from '~/lib/local-repo';
import { listKeys, type GpgKeyRecord } from '~/lib/gpg';

export interface LocalRepoView extends LocalRepo {
  gpgKey: GpgKeyRecord | null;
  packages: LocalRepoPackage[];
  snippet: string;
}

export async function loader({ request }: { request: Request }) {
  await requireAuthMiddleware(request);

  const [repos, keys] = await Promise.all([
    listRepos(),
    listKeys().catch(() => ({}) as Record<string, GpgKeyRecord>),
  ]);

  const views: LocalRepoView[] = await Promise.all(
    repos.map(async (repo) => {
      const gpgKey = keys[repo.host] ?? null;
      const packages = await listPackages(repo.host).catch(() => []);
      return { ...repo, gpgKey, packages, snippet: sourcesSnippet(repo, gpgKey) };
    }),
  );

  return { repos: views };
}
