import { describe, it, expect } from 'vitest';
import { DEFAULT_DOWNLOAD_NAME, fileNameFromUrl } from './download-name';

describe('fileNameFromUrl (r3-files-9)', () => {
  it.each([
    ['http://example.test/ok%20space%231.txt', 'ok space#1.txt'],
    ['http://example.test/dir/%E6%97%A5%E6%9C%AC.zip?x=1#frag', '日本.zip'],
    ['https://github.com/o/r/releases/download/v1/tool.tar.gz', 'tool.tar.gz'],
    ['http://example.test/bad%E0%A4%A.txt', 'bad%E0%A4%A.txt'],
  ])('%s -> %s', (url, name) => {
    expect(fileNameFromUrl(url)).toBe(name);
  });

  it('falls back to a default name when the URL has none', () => {
    expect(fileNameFromUrl('http://example.test/ok/')).toBe(DEFAULT_DOWNLOAD_NAME);
    expect(fileNameFromUrl('http://example.test')).toBe(DEFAULT_DOWNLOAD_NAME);
    expect(fileNameFromUrl('not a url')).toBe(DEFAULT_DOWNLOAD_NAME);
  });
});
