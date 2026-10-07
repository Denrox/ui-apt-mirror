export interface DocumentationSection {
  id: string;
  linkName: string;
  title: string;
}

export function documentationSections(
  isNpmProxyEnabled: boolean,
): DocumentationSection[] {
  return [
    {
      id: 'file-structure',
      linkName: 'File Structure',
      title: 'File Structure',
    },
    { id: 'commands', linkName: 'Commands', title: 'Commands' },
    ...(isNpmProxyEnabled
      ? [
          {
            id: 'npm-proxy',
            linkName: 'NPM Proxy',
            title: 'NPM Proxy Configuration',
          },
        ]
      : []),
  ];
}

export function findDocumentationSection(
  id: string | undefined,
  isNpmProxyEnabled: boolean,
): DocumentationSection | undefined {
  return documentationSections(isNpmProxyEnabled).find((s) => s.id === id);
}

/** One line, so it can be copied as shown (npm 9+ needs the legacy auth type). */
export function npmLoginCommand(npmHost: string): string {
  return `npm login --registry=http://${npmHost} --auth-type=legacy`;
}

/** The commands that point each package manager at the registry, one per line. */
export function npmClientSetup(npmHost: string): { client: string; commands: string[] }[] {
  const registry = `http://${npmHost}`;
  return [
    { client: 'npm', commands: [`npm config set registry ${registry}`] },
    { client: 'pnpm', commands: [`pnpm config set registry ${registry}`] },
    { client: 'Yarn 1', commands: [`yarn config set registry ${registry}`] },
    {
      // Yarn 2+ refuses plain http registries unless the host is whitelisted.
      client: 'Yarn 2+',
      commands: [
        `yarn config set npmRegistryServer ${registry}`,
        `yarn config set unsafeHttpWhitelist --json '["${npmHost}"]'`,
      ],
    },
  ];
}
