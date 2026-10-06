/**
 * Copy text to the clipboard. The admin UI is usually served over plain HTTP,
 * where navigator.clipboard is unavailable, so fall back to execCommand.
 */
export async function copyText(
  text: string,
  doc: Document = document,
): Promise<boolean> {
  const clipboard = doc.defaultView?.navigator.clipboard;
  if (clipboard && doc.defaultView?.isSecureContext) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  doc.body.appendChild(textarea);
  textarea.select();
  try {
    return doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
