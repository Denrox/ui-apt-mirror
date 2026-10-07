export const MIN_PASSWORD_LENGTH = 4;
// openssl passwd reads one line and ignores everything past 256 bytes.
export const MAX_PASSWORD_BYTES = 256;
// Usernames end up in the session JWT, which travels in a cookie header.
export const MAX_USERNAME_LENGTH = 64;
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Whether `password` can be hashed as typed: no line breaks or other control characters, not too long. */
export function isHashablePassword(password: string): boolean {
  return (
    !CONTROL_CHARS.test(password) &&
    new TextEncoder().encode(password).length <= MAX_PASSWORD_BYTES
  );
}

/** Why `password` is not acceptable for an account, or null. */
export function passwordError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }
  if (CONTROL_CHARS.test(password)) {
    return 'Password must not contain line breaks, tabs or other control characters';
  }
  if (!isHashablePassword(password)) {
    return `Password is too long (at most ${MAX_PASSWORD_BYTES} bytes; fewer characters if it uses non-ASCII ones)`;
  }
  return null;
}

/**
 * Why `username` is not a valid account name, or null. `anyLength` accepts
 * names over the limit, so accounts made before it existed can be deleted.
 */
export function usernameError(
  username: string,
  { anyLength = false }: { anyLength?: boolean } = {},
): string | null {
  if (!USERNAME_PATTERN.test(username)) {
    return 'Username can only contain letters, numbers, hyphens, and underscores';
  }
  if (!anyLength && username.length > MAX_USERNAME_LENGTH) {
    return `Username must be at most ${MAX_USERNAME_LENGTH} characters long`;
  }
  return null;
}
