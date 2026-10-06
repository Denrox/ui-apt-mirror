export const MIN_PASSWORD_LENGTH = 4;

/** Why `password` is not acceptable for an account, or null. */
export function passwordError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }
  return null;
}
