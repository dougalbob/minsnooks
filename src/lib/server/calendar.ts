import type { Db } from './db';
import { isIsoDate, localDateString } from './league-time';
import type { ViewerPlayer } from './viewer';

export type AvailabilityStatus = 'available' | 'unavailable';
export interface CalendarEntry { date: string; time: string | null; kind: 'league' | 'friendly' | 'knockout'; state: 'proposed' | 'agreed' | 'scheduled'; label: string; href: string; }
export interface AvailabilityEntry { date: string; playerId: number; name: string; status: AvailabilityStatus; }

/** Only signed-in, registered members see availability or private plans. */
export function loadCalendar(db: Db, viewer: ViewerPlayer | null, month: string, now = new Date()) {
  if (!viewer) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid calendar month.');
  const start = `${month}-01`;
  const [year, part] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, part, 1)).toISOString().slice(0, 10);
  const availability = db.prepare(`SELECT a.local_date AS date,a.player_id AS playerId,p.display_name AS name,a.status
    FROM availability a JOIN players p ON p.id=a.player_id
    WHERE a.local_date>=? AND a.local_date<? AND p.is_active=1 ORDER BY a.local_date,p.display_name`).all(start,end) as AvailabilityEntry[];
  const league = db.prepare(`SELECT b.proposed_date AS date,b.proposed_time AS time,
    CASE WHEN ba.booking_id IS NULL THEN 'proposed' ELSE 'agreed' END AS state,
    lo.display_name || ' vs ' || hi.display_name AS label, '/fixtures/' || f.id AS href
    FROM bookings b JOIN fixtures f ON f.id=b.fixture_id
    JOIN players lo ON lo.id=f.player_low_id JOIN players hi ON hi.id=f.player_high_id
    LEFT JOIN booking_acceptances ba ON ba.booking_id=b.id
    WHERE b.status='proposed' AND b.proposed_date>=? AND b.proposed_date<?
      AND (f.player_low_id=? OR f.player_high_id=? OR ba.booking_id IS NOT NULL)
    ORDER BY b.proposed_date,b.id`).all(start,end,viewer.playerId,viewer.playerId) as Array<Omit<CalendarEntry,'kind'>>;
  const friendlies = db.prepare(`SELECT f.scheduled_date AS date,f.scheduled_time AS time,
    lo.display_name || ' vs ' || hi.display_name AS label,'/friendlies/' || f.id AS href
    FROM friendlies f JOIN players lo ON lo.id=f.player_low_id JOIN players hi ON hi.id=f.player_high_id
    WHERE f.status='scheduled' AND f.scheduled_date>=? AND f.scheduled_date<?
      AND ? IN (f.player_low_id,f.player_high_id)`).all(start,end,viewer.playerId) as Array<{date:string;time:string|null;label:string;href:string}>;
  const knockout = db.prepare(`SELECT a.proposed_date AS date,a.proposed_time AS time,
    lo.display_name || ' vs ' || hi.display_name AS label,'/knockout' AS href
    FROM knockout_arrangements a JOIN knockout_ties t ON t.id=a.tie_id
    JOIN players lo ON lo.id=t.player_low_id JOIN players hi ON hi.id=t.player_high_id
    WHERE a.status='proposed' AND a.proposed_date>=? AND a.proposed_date<?
      AND ? IN (t.player_low_id,t.player_high_id)`).all(start,end,viewer.playerId) as Array<{date:string;time:string|null;label:string;href:string}>;
  const entries: CalendarEntry[] = [
    ...league.map((e) => ({...e,kind:'league' as const})),
    ...friendlies.map((e) => ({...e,kind:'friendly' as const,state:'scheduled' as const})),
    ...knockout.map((e) => ({...e,kind:'knockout' as const,state:'proposed' as const}))
  ].sort((a,b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
  return { month, today: localDateString(now, 'Europe/London'), entries, availability, previous: new Date(Date.UTC(year,part-2,1)).toISOString().slice(0,7), next: end.slice(0,7) };
}

/** Writes only one's own day; removing a mark is safe and idempotent. */
export function setAvailability(db: Db, viewer: ViewerPlayer | null, date: string, status: AvailabilityStatus | 'clear', now = new Date()): void {
  if (!viewer) throw new Error('Sign in to update your availability.');
  if (!isIsoDate(date) || date < localDateString(now,'Europe/London')) throw new Error('Choose today or a future date.');
  if (!['available','unavailable','clear'].includes(status)) throw new Error('Choose an availability status.');
  if (status === 'clear') db.prepare('DELETE FROM availability WHERE player_id=? AND local_date=?').run(viewer.playerId,date);
  else db.prepare(`INSERT INTO availability (player_id,local_date,status) VALUES (?,?,?)
    ON CONFLICT(player_id,local_date) DO UPDATE SET status=excluded.status`).run(viewer.playerId,date,status);
}
