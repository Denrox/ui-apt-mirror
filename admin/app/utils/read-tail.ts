import fs from 'fs/promises';

type FileHandle = Awaited<ReturnType<typeof fs.open>>;

// Logs only grow between reads, so each one's newline count is kept and only
// the new part is counted next time. A smaller file or another inode
// (rotated, truncated) is counted again from the start.
const newlineCounts = new Map<string, { ino: number; end: number; count: number }>();

async function countNewlines(handle: FileHandle, file: string, ino: number, end: number): Promise<number> {
  const cached = newlineCounts.get(file);
  const resume = cached && cached.ino === ino && cached.end <= end;
  let count = resume ? cached.count : 0;
  const buffer = Buffer.alloc(Math.min(1 << 20, Math.max(1, end)));
  for (let pos = resume ? cached.end : 0; pos < end; ) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, end - pos), pos);
    if (!bytesRead) break;
    const chunk = buffer.subarray(0, bytesRead);
    for (let i = chunk.indexOf(10); i !== -1; i = chunk.indexOf(10, i + 1)) count++;
    pos += bytesRead;
  }
  newlineCounts.set(file, { ino, end, count });
  return count;
}

/**
 * Last `maxBytes` of a text file, starting at a whole line when cut.
 * `firstLine` is the line number of the first returned line in the whole file.
 */
export async function readTail(
  file: string,
  maxBytes: number,
): Promise<{ content: string; size: number; truncated: boolean; firstLine: number }> {
  const handle = await fs.open(file, 'r');
  try {
    const { size, ino } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    let content = buffer.subarray(0, bytesRead).toString('utf-8');
    let firstLine = 1;
    if (start > 0) {
      const firstNewline = content.indexOf('\n');
      content = firstNewline === -1 ? '' : content.slice(firstNewline + 1);
      // The lines before the cut, plus the partial line that was dropped.
      firstLine = (await countNewlines(handle, file, ino, start)) + 2;
    }
    return { content, size, truncated: start > 0, firstLine };
  } finally {
    await handle.close();
  }
}
