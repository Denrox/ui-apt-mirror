import { describe, it, expect } from 'vitest';
import { findDocumentationSection, npmLoginCommand } from './documentation-sections';

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
