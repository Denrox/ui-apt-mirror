export const MIN_PASSWORD_LENGTH = 4;
// Usernames end up in the session JWT, which travels in a cookie header.
export const MAX_USERNAME_LENGTH = 64;
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Why `password` is not acceptable for an account, or null. */
export function passwordError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
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
