import { describe, it, expect } from 'vitest';
import { getValidationError } from './file-name';

describe('getValidationError', () => {
  it('accepts ordinary names, including non-ASCII ones up to 255 bytes', () => {
    expect(getValidationError('report 2026.pdf')).toBeNull();
    expect(getValidationError('Übersicht – 日本.txt')).toBeNull();
    expect(getValidationError('r2-files-' + 'M'.repeat(246))).toBeNull();
    expect(getValidationError('日'.repeat(85))).toBeNull();
  });

  it.each([
    ['empty', '  '],
    ['hidden', '.env'],
    ['traversal', '../x'],
    ['slash', 'a/b'],
    ['control character', 'a\nb'],
    ['reserved character', 'a?b'],
  ])('rejects a %s name', (_kind, name) => {
    expect(getValidationError(name)).not.toBeNull();
  });

  it('rejects names longer than 255 bytes with a clear message', () => {
    expect(getValidationError('M'.repeat(256))).toMatch(/too long/);
    expect(getValidationError('日'.repeat(100))).toMatch(/too long/);
  });

  it.each(['‮', '‪', '⁦', '⁩', '​', '‏', '﻿', '؜'])(
    'rejects names with the invisible character U+%s',
    (char) => {
      expect(getValidationError(`r2-files-${char}txt.exe`)).toMatch(/invisible/);
    },
  );
});
