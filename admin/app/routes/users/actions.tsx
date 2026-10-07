import { readFileSync } from 'fs';
import { data } from 'react-router';
import appConfig from '~/config/config.json';
import { hashPassword, withAuthFileLock, writePrivateFile } from '~/utils/htpasswd';
import { passwordError, usernameError } from '~/utils/password-rules';

function lineUsername(line: string): string | null {
  if (!line.trim() || line.startsWith('#') || !line.includes(':')) return null;
  return line.substring(0, line.indexOf(':'));
}

function userExists(content: string, username: string): boolean {
  return content.split('\n').some((line) => lineUsername(line) === username);
}

type ActionResult = { success: boolean; message?: string; error?: string };

export async function action({
  request,
}: {
  request: Request;
}): Promise<ActionResult | ReturnType<typeof data<ActionResult>>> {
  const { requireAuth, revokeUserTokens, createAuthToken, createAuthCookie } =
    await import('~/utils/server-auth');
  const user = await requireAuth(request);

  if (!user) {
    throw new Response(null, {
      status: 302,
      headers: { Location: '/login' },
    });
  }

  const formData = await request.formData();
  const intent = formData.get('intent') as string;

  const isAdmin = user.username === 'admin';

  if (intent === 'changePassword') {
    const username = formData.get('username') as string;
    const newPassword = formData.get('newPassword') as string;

    if (!username || !newPassword) {
      return {
        success: false,
        error: 'Username and new password are required',
      };
    }

    if (!isAdmin && username !== user.username) {
      return {
        success: false,
        error: 'You can only change your own password',
      };
    }

    const newPasswordError = passwordError(newPassword);
    if (newPasswordError) {
      return { success: false, error: newPasswordError };
    }

    try {
      const passwordHash = await hashPassword(newPassword);
      const htpasswdPath = appConfig.htpasswdPath;
      const userFound = await withAuthFileLock(() => {
        const lines = readFileSync(htpasswdPath, 'utf-8').split('\n');
        let found = false;
        const updatedLines = lines.map((line) => {
          if (lineUsername(line) !== username) return line;
          found = true;
          return `${username}:${passwordHash}`;
        });
        if (!found) return false;
        writePrivateFile(htpasswdPath, updatedLines.join('\n'));
        revokeUserTokens(username);
        return true;
      });

      if (!userFound) {
        return { success: false, error: 'User not found' };
      }

      const result = {
        success: true,
        message: `Password changed successfully for ${username}`,
      };
      if (username !== user.username) return result;
      // The change revoked the current session too; hand out a fresh one.
      const cookie = createAuthCookie(await createAuthToken(username));
      return data(result, { headers: { 'Set-Cookie': cookie } });
    } catch (error) {
      console.error('Error changing password:', error);
      return { success: false, error: 'Failed to change password' };
    }
  }

  if (intent === 'deleteUser') {
    if (!isAdmin) {
      return { success: false, error: 'Only admin can delete users' };
    }

    const username = formData.get('username') as string;

    if (!username) {
      return { success: false, error: 'Username is required' };
    }

    const deleteNameError = usernameError(username, { anyLength: true });
    if (deleteNameError) {
      return { success: false, error: deleteNameError };
    }

    if (username === 'admin') {
      return { success: false, error: 'Cannot delete admin user' };
    }

    try {
      const htpasswdPath = appConfig.htpasswdPath;
      const deleted = await withAuthFileLock(() => {
        const content = readFileSync(htpasswdPath, 'utf-8');
        if (!userExists(content, username)) return false;
        const filteredLines = content
          .split('\n')
          .filter((line) => lineUsername(line) !== username);
        writePrivateFile(htpasswdPath, filteredLines.join('\n'));
        revokeUserTokens(username);
        return true;
      });

      if (!deleted) {
        return { success: false, error: 'User not found' };
      }

      return {
        success: true,
        message: `User ${username} deleted successfully`,
      };
    } catch (error) {
      console.error('Error deleting user:', error);
      return { success: false, error: 'Failed to delete user' };
    }
  }

  if (intent === 'addUser') {
    if (!isAdmin) {
      return { success: false, error: 'Only admin can add users' };
    }

    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

    if (!username || !password) {
      return { success: false, error: 'Username and password are required' };
    }

    const addNameError = usernameError(username);
    if (addNameError) {
      return { success: false, error: addNameError };
    }

    const addPasswordError = passwordError(password);
    if (addPasswordError) {
      return { success: false, error: addPasswordError };
    }

    try {
      const htpasswdPath = appConfig.htpasswdPath;
      if (userExists(readFileSync(htpasswdPath, 'utf-8'), username)) {
        return { success: false, error: 'User already exists' };
      }

      const passwordHash = await hashPassword(password);
      // Check again under the lock: another request may have added the
      // same name while this one was hashing.
      const created = await withAuthFileLock(() => {
        const current = readFileSync(htpasswdPath, 'utf-8');
        if (userExists(current, username)) return false;
        const separator = current && !current.endsWith('\n') ? '\n' : '';
        writePrivateFile(
          htpasswdPath,
          `${current}${separator}${username}:${passwordHash}\n`,
        );
        return true;
      });

      if (!created) {
        return { success: false, error: 'User already exists' };
      }

      return {
        success: true,
        message: `User ${username} created successfully`,
      };
    } catch (error) {
      console.error('Error creating user:', error);
      return { success: false, error: 'Failed to create user' };
    }
  }

  return { success: false, error: 'Invalid action' };
}
