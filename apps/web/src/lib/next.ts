/** Where to go after signing in: a path on this site from ?next=, or home. */
export function nextPath(search: string): string {
  const next = new URLSearchParams(search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
