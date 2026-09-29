import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { saveSubscription, removeSubscription } from '$lib/server/notifications';
import type { RequestHandler } from './$types';
const handle: RequestHandler = async ({ request, locals, url }) => {
  if (request.headers.get('origin') !== url.origin) throw error(403,'Invalid origin.');
  const viewer = loadViewerPlayer(getDb(),locals.viewerEmail);
  if (!viewer) throw error(403,'Sign in first.');
  let body: unknown;
  try { body = await request.json(); } catch { throw error(400,'Invalid JSON.'); }
  try {
    if (request.method === 'DELETE') removeSubscription(getDb(),viewer,(body as {endpoint?:unknown})?.endpoint);
    else saveSubscription(getDb(),viewer,body);
  } catch (cause) { throw error(400,cause instanceof Error ? cause.message : 'Invalid subscription.'); }
  return json({ok:true},{headers:{'Cache-Control':'no-store'}});
};
export const POST = handle;
export const DELETE = handle;
