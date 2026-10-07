/** Name a URL download gets when its URL has none (it ends in `/`, or is not a URL). */
export const DEFAULT_DOWNLOAD_NAME = 'downloaded-file';

/** File name suggested for a download from `url`: its last path segment, percent-decoded. */
export function fileNameFromUrl(url: string): string {
  let segment: string;
  try {
    segment = new URL(url.trim()).pathname.split('/').pop() ?? '';
  } catch {
    return DEFAULT_DOWNLOAD_NAME;
  }
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // A malformed escape: keep the segment as written.
  }
  return segment || DEFAULT_DOWNLOAD_NAME;
}
