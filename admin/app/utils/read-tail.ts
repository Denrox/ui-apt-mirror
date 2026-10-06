import fs from 'fs/promises';

/** Last `maxBytes` of a text file, starting at a whole line when cut. */
export async function readTail(
  file: string,
  maxBytes: number,
): Promise<{ content: string; size: number; truncated: boolean }> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    let content = buffer.subarray(0, bytesRead).toString('utf-8');
    if (start > 0) {
      const firstNewline = content.indexOf('\n');
      content = firstNewline === -1 ? '' : content.slice(firstNewline + 1);
    }
    return { content, size, truncated: start > 0 };
  } finally {
    await handle.close();
  }
}
