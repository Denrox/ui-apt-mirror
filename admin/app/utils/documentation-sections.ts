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
