import { describe, it, expect } from 'vitest';
import { readFormData, BodyTooLargeError } from './limited-form-data';

const post = (form: FormData) => new Request('http://admin.test/api/upload-chunk', { method: 'POST', body: form });

// A body sent without Content-Length, as with chunked transfer encoding.
const streamed = (bytes: number) =>
  new Request('http://admin.test/x', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=b' },
    body: new ReadableStream({
      start(controller) {
        for (let sent = 0; sent < bytes; sent += 1024) controller.enqueue(new Uint8Array(1024));
        controller.close();
      },
    }),
    duplex: 'half',
  } as RequestInit);

describe('readFormData', () => {
  it('parses a body within the limit', async () => {
    const form = new FormData();
    form.append('intent', 'uploadChunk');
    form.append('chunk', new Blob([new Uint8Array(4096).fill(7)]), 'blob');
    const parsed = await readFormData(post(form), 64 * 1024);
    expect(parsed.get('intent')).toBe('uploadChunk');
    const chunk = parsed.get('chunk') as File;
    expect(new Uint8Array(await chunk.arrayBuffer())).toEqual(new Uint8Array(4096).fill(7));
  });

  it('refuses a body whose declared length is over the limit', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(70 * 1024)]), 'big.bin');
    await expect(readFormData(post(form), 64 * 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('stops reading a streamed body once it passes the limit', async () => {
    await expect(readFormData(streamed(200 * 1024), 64 * 1024)).rejects.toThrow(
      'The request is too large',
    );
  });
});
