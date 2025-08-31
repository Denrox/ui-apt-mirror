export const getHostAddress = (host: string) => {
  if (typeof window !== 'undefined') {
    return `http://${host}`.replace(
      'domain',
      window.location.hostname.replace('admin.', ''),
    );
  }
  return `http://${host}`;
};
