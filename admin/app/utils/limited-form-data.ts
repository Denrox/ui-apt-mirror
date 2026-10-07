/** Largest request body the file manager reads: one 10 MB upload chunk plus form overhead. */
export const MAX_FORM_BYTES = 32 * 1024 * 1024;

export class BodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`The request is too large (at most ${Math.floor(limit / 1024 / 1024)} MB)`);
  }
}

/**
 * request.formData(), but refusing a body larger than `limit` without reading it all:
 * formData() alone holds a body of any size in memory.
 */
export async function readFormData(request: Request, limit = MAX_FORM_BYTES): Promise<FormData> {
  const declared = Number(request.headers.get('content-length'));
  // The rest of a refused body is left unread rather than cancelled: cancelling resets the
  // connection, so the client would never see the answer.
  if (declared > limit) throw new BodyTooLargeError(limit);
  const parts: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        reader.releaseLock();
        throw new BodyTooLargeError(limit);
      }
      parts.push(value);
    }
  }
  const body = Buffer.concat(parts, size);
  parts.length = 0;
  return new Response(body, {
    headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
  }).formData();
}
