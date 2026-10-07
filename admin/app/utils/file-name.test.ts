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

  it.each([
    ['NEL', '\u0085'],
    ['CSI', '\u009B'],
    ['line separator', '\u2028'],
    ['paragraph separator', '\u2029'],
    ['soft hyphen', '\u00AD'],
    ['Mongolian vowel separator', '\u180E'],
    ['Hangul filler', '\u3164'],
    ['Hangul choseong filler', '\u115F'],
    ['halfwidth Hangul filler', '\uFFA0'],
    ['tag character', '\u{E0041}'],
    ['division slash', '\u2215'],
    ['fullwidth slash', '\uFF0F'],
  ])('rejects a name with a %s', (_kind, char) => {
    expect(getValidationError(`r3-files-a${char}b`)).not.toBeNull();
  });

  it.each([
    ['Braille blank', '\u2800'],
    ['combining grapheme joiner', '\u034F'],
    ['variation selector', '\uFE0F'],
    ['variation selector supplement', '\u{E0100}'],
    ['musical null notehead', '\u{1D159}'],
  ])('rejects a name with a blank or ignorable %s', (_kind, char) => {
    expect(getValidationError(`a${char}b`)).toMatch(/invisible/);
    expect(getValidationError(`${char}name.txt`)).toMatch(/invisible/);
  });

  it('keeps a variation selector right after an emoji', () => {
    expect(getValidationError('\u2764\uFE0F notes.txt')).toBeNull();
    expect(getValidationError('a\uFE0F\u2764.txt')).toMatch(/invisible/);
    expect(getValidationError('\u2764\uFE0F\uFE0F.txt')).toMatch(/invisible/);
  });

  it('rejects a name starting with a combining mark, but keeps accents on letters', () => {
    expect(getValidationError('\u0301name')).toMatch(/invisible/);
    expect(getValidationError('Cafe\u0301.txt')).toBeNull();
  });

  it.each([' r3-files-lead', 'r3-files-trail ', 'r3-files-nbsp\u00A0', '\u3000r3-files-ideo'])(
    'rejects leading or trailing whitespace in %j',
    (name) => {
      expect(getValidationError(name)).toMatch(/start or end with a space/);
    },
  );

  it('still accepts inner spaces, accents and CJK', () => {
    expect(getValidationError('my report (final).pdf')).toBeNull();
    expect(getValidationError('Café ünï 日本.txt')).toBeNull();
  });
});
