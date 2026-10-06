import { describe, it, expect, vi } from 'vitest';
import { copyText } from './copy-text';

function fakeDocument(secure: boolean, execResult = true) {
  const textarea = {
    value: '',
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(),
    remove: vi.fn(),
  };
  const writeText = vi.fn().mockResolvedValue(undefined);
  const doc = {
    defaultView: {
      isSecureContext: secure,
      navigator: { clipboard: { writeText } },
    },
    createElement: vi.fn(() => textarea),
    body: { appendChild: vi.fn() },
    execCommand: vi.fn(() => execResult),
  };
  return {
    doc: doc as unknown as Document,
    textarea,
    writeText,
    execCommand: doc.execCommand,
  };
}

describe('copyText', () => {
  it('uses the Clipboard API in a secure context', async () => {
    const { doc, writeText, execCommand } = fakeDocument(true);
    expect(await copyText('deb x', doc)).toBe(true);
    expect(writeText).toHaveBeenCalledWith('deb x');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to execCommand over plain HTTP', async () => {
    const { doc, textarea, writeText, execCommand } = fakeDocument(false);
    expect(await copyText('deb x', doc)).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    expect(textarea.value).toBe('deb x');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(textarea.remove).toHaveBeenCalled();
  });

  it('reports a failed copy', async () => {
    const { doc } = fakeDocument(false, false);
    expect(await copyText('deb x', doc)).toBe(false);
  });
});
