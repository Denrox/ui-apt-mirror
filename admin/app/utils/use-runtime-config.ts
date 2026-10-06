import { useRouteLoaderData } from 'react-router';
import type { HostConfig } from './hosts';

export interface RuntimeConfig {
  isNpmProxyEnabled: boolean;
  hosts: HostConfig[];
}

export function useRuntimeConfig(): RuntimeConfig {
  const data = useRouteLoaderData('root') as { runtimeConfig: RuntimeConfig };
  return data.runtimeConfig;
}

/** Address of one of the app's hosts, e.g. hostOf(hosts, 'npm') -> "npm.mirror.intra". */
export function hostOf(hosts: HostConfig[], id: string): string {
  return hosts.find((h) => h.id === id)?.address ?? '';
}
