export interface RegistryInfo {
  registry: string;
  repository: string;
}

/**
 * Registry and repository of an image name, as Docker reads it: a first segment with a `.`
 * or `:`, or `localhost`, is a registry host (quay.io, ghcr.io, registry.k8s.io,
 * localhost:5000, …); anything else is on Docker Hub, single names under `library/`.
 * Null when the name carries a tag or digest (the tag has its own field).
 */
export function parseImageUrl(imageUrl: string): RegistryInfo | null {
  const slash = imageUrl.indexOf('/');
  if (slash === -1) {
    if (imageUrl.includes(':')) return null;
    return { registry: 'docker.io', repository: `library/${imageUrl}` };
  }
  const first = imageUrl.slice(0, slash);
  const rest = imageUrl.slice(slash + 1);
  if (!rest || rest.includes(':')) return null;
  if (first === 'docker.io' || first === 'index.docker.io') {
    return { registry: 'docker.io', repository: rest };
  }
  if (first.includes('.') || first.includes(':') || first === 'localhost') {
    return { registry: first, repository: rest };
  }
  return { registry: 'docker.io', repository: imageUrl };
}
