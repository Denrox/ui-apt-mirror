import { useRouteLoaderData } from 'react-router';

export interface RuntimeConfig {
  isNpmProxyEnabled: boolean;
}

export function useRuntimeConfig(): RuntimeConfig {
  const data = useRouteLoaderData('root') as { runtimeConfig: RuntimeConfig };
  return data.runtimeConfig;
}
