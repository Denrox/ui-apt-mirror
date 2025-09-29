/**
 * Middleware to protect routes that require authentication
 */
export async function requireAuthMiddleware(request: Request) {
  const { requireAuth } = await import('./server-auth');

  const user = await requireAuth(request);

  if (!user) {
    throw new Response(null, {
      status: 302,
      headers: {
        Location: '/login',
      },
    });
  }

  return user;
}

/**
 * Middleware to check if user is authenticated (for optional auth)
 */
export async function optionalAuthMiddleware(request: Request) {
  const { requireAuth } = await import('./server-auth');

  return await requireAuth(request);
}
