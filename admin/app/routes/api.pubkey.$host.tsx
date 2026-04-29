import { exportPublicKey, assertValidHost } from '~/lib/gpg';

export async function loader({ params }: { params: { host: string } }) {
  const host = params.host;
  try {
    assertValidHost(host);
  } catch {
    throw new Response('Invalid host', { status: 400 });
  }

  try {
    const key = await exportPublicKey(host);
    return new Response(key, {
      headers: {
        'Content-Type': 'application/pgp-keys',
        'Content-Disposition': `attachment; filename="${host}.asc"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error exporting public key:', error);
    throw new Response('Public key not found', { status: 404 });
  }
}
