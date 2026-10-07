import { describe, it, expect } from 'vitest';
import { findDocumentationSection, npmClientSetup, npmLoginCommand } from './documentation-sections';

describe('findDocumentationSection', () => {
  it('finds the known sections', () => {
    expect(findDocumentationSection('commands', false)?.title).toBe('Commands');
    expect(findDocumentationSection('npm-proxy', true)?.title).toBe(
      'NPM Proxy Configuration',
    );
  });

  it('rejects unknown sections and the npm section when the proxy is off', () => {
    expect(findDocumentationSection('anything', true)).toBeUndefined();
    expect(findDocumentationSection(undefined, true)).toBeUndefined();
    expect(findDocumentationSection('npm-proxy', false)).toBeUndefined();
  });
});

describe('npmLoginCommand', () => {
  it('separates the registry from the auth type', () => {
    expect(npmLoginCommand('npm.mirror.intra')).toBe(
      'npm login --registry=http://npm.mirror.intra --auth-type=legacy',
    );
  });
});

describe('npmClientSetup', () => {
  it('points every package manager at the registry, and lets Yarn 2+ use plain http', () => {
    const setup = Object.fromEntries(npmClientSetup('npm.mirror.intra').map((c) => [c.client, c.commands]));
    expect(Object.keys(setup)).toEqual(['npm', 'pnpm', 'Yarn 1', 'Yarn 2+']);
    expect(setup.npm).toEqual(['npm config set registry http://npm.mirror.intra']);
    expect(setup['Yarn 2+']).toEqual([
      'yarn config set npmRegistryServer http://npm.mirror.intra',
      `yarn config set unsafeHttpWhitelist --json '["npm.mirror.intra"]'`,
    ]);
  });
});
