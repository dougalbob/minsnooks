import { fail, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { loadCalendar, setAvailability } from '$lib/server/calendar';
import { localDateString } from '$lib/server/league-time';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
  const viewer = loadViewerPlayer(getDb(), locals.viewerEmail);
  const month = url.searchParams.get('month') ?? localDateString(new Date(),'Europe/London').slice(0,7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw error(400,'Invalid month.');
  return { calendar: loadCalendar(getDb(),viewer,month) };
};
export const actions: Actions = {
  availability: async ({ locals, request }) => {
    const viewer = loadViewerPlayer(getDb(),locals.viewerEmail);
    if (!viewer) return fail(403,{ message: 'Sign in to change your availability.' });
    const form = await request.formData();
    try { setAvailability(getDb(),viewer,String(form.get('date') ?? ''),String(form.get('status') ?? '') as 'available'|'unavailable'|'clear'); }
    catch (e) { return fail(400,{message: e instanceof Error ? e.message : 'Could not save availability.'}); }
    return { message: 'Availability updated.' };
  }
};
