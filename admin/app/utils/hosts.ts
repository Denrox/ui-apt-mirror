import appConfig from '~/config/config.json';

export type HostConfig = (typeof appConfig.hosts)[number];

/** The app's hosts on this install: MIRROR_DOMAIN in place of the built-in mirror.intra. Server only. */
export function configuredHosts(domain = process.env.MIRROR_DOMAIN || 'mirror.intra'): HostConfig[] {
  return appConfig.hosts.map((h) => ({ ...h, address: h.address.replace(/mirror\.intra$/, domain) }));
}

export function hostAddress(id: string): string {
  return configuredHosts().find((h) => h.id === id)?.address ?? '';
}

/** Usage lines written for the built-in mirror.intra (stock list, older sections) point at this install's host. */
export function withMirrorHost(lines: string[], host: string): string[] {
  return lines.map((line) => line.replace(/(https?:\/\/)mirror\.intra(?=[/:\s]|$)/g, `$1${host}`));
}
