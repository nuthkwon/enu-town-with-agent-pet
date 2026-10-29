import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getViewer, type Viewer } from './session';

/** Server components: the current viewer from the incoming request headers. */
export async function getPageViewer(): Promise<Viewer | null> {
  return getViewer(await headers());
}

/** Server components: redirect to /sign-in?next=<path> when signed out. */
export async function requirePageViewer(nextPath: string): Promise<Viewer> {
  const v = await getPageViewer();
  if (!v) redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`);
  return v;
}
