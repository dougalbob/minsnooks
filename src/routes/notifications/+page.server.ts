import { env } from '$env/dynamic/private';
import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { inbox, readNotification } from '$lib/server/notifications';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = ({ locals }) => {
  const viewer = loadViewerPlayer(getDb(),locals.viewerEmail);
  return { items: inbox(getDb(),viewer), signedIn: Boolean(viewer), publicKey: env.VAPID_PUBLIC_KEY ?? '' };
};
export const actions: Actions = {
  open: async ({locals,request}) => {
    const viewer = loadViewerPlayer(getDb(),locals.viewerEmail);
    const form = await request.formData();
    let href: string;
    try { href = readNotification(getDb(),viewer,Number(form.get('id'))); }
    catch { return fail(404,{message:'Notification not found.'}); }
    throw redirect(303,href);
  }
};
