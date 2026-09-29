import webpush from 'web-push';
import type { Db } from './db';
import type { ViewerPlayer } from './viewer';

export interface InboxItem { id: number; kind: string; title: string; href: string; created_at: string; read_at: string | null; }
export function inbox(db: Db, viewer: ViewerPlayer | null): InboxItem[] {
  if (!viewer) return [];
  return db.prepare('SELECT id,kind,title,href,created_at,read_at FROM notifications WHERE player_id=? ORDER BY id DESC LIMIT 80').all(viewer.playerId) as InboxItem[];
}
export function unreadCount(db: Db, viewer: ViewerPlayer | null): number {
  if (!viewer) return 0;
  return (db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE player_id=? AND read_at IS NULL').get(viewer.playerId) as {n:number}).n;
}
export function readNotification(db: Db, viewer: ViewerPlayer | null, id: number) {
  if (!viewer || !Number.isSafeInteger(id) || id < 1) throw new Error('Notification not found.');
  const row = db.prepare('SELECT href FROM notifications WHERE id=? AND player_id=?').get(id,viewer.playerId) as {href:string}|undefined;
  if (!row) throw new Error('Notification not found.');
  db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND player_id=?').run(new Date().toISOString(),id,viewer.playerId);
  return row.href;
}
export function saveSubscription(db: Db, viewer: ViewerPlayer | null, subscription: unknown) {
  if (!viewer) throw new Error('Sign in first.');
  if (!subscription || typeof subscription !== 'object') throw new Error('Invalid subscription.');
  const value = subscription as {endpoint?:unknown;keys?:{p256dh?:unknown;auth?:unknown}};
  if (typeof value.endpoint !== 'string' || value.endpoint.length > 2048 || !value.endpoint.startsWith('https://') ||
      typeof value.keys?.p256dh !== 'string' || value.keys.p256dh.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value.keys.p256dh) ||
      typeof value.keys?.auth !== 'string' || value.keys.auth.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value.keys.auth)) throw new Error('Invalid subscription.');
  // Limit outgoing server requests to known browser push services (no arbitrary URL SSRF).
  const host = new URL(value.endpoint).hostname.toLowerCase();
  if (!['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','push.apple.com'].includes(host)
    && !host.endsWith('.notify.windows.com')) throw new Error('Unsupported push service.');
  // An endpoint already owned by someone else cannot be claimed by switching identity.
  const owner = db.prepare('SELECT player_id FROM push_subscriptions WHERE endpoint=?').get(value.endpoint) as {player_id:number}|undefined;
  if (owner && owner.player_id !== viewer.playerId) throw new Error('This browser is already subscribed under another member. Remove the old subscription first.');
  db.prepare(`INSERT INTO push_subscriptions (player_id,endpoint,p256dh,auth) VALUES (?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth`).run(viewer.playerId,value.endpoint,value.keys.p256dh,value.keys.auth);
}
export function removeSubscription(db: Db, viewer: ViewerPlayer | null, endpoint: unknown) {
  if (!viewer || typeof endpoint !== 'string') throw new Error('Sign in first.');
  db.prepare('DELETE FROM push_subscriptions WHERE player_id=? AND endpoint=?').run(viewer.playerId,endpoint);
}

let sending = false;
/** Best-effort bounded dispatcher. Failed sends remain pending for next tick;
 * 404/410 endpoints are removed. A single process is expected on Unraid. */
export async function dispatchPush(db: Db, config: { publicKey?:string; privateKey?:string; subject?:string }): Promise<number> {
  if (!config.publicKey || !config.privateKey || !config.subject || sending) return 0;
  sending = true;
  try {
    webpush.setVapidDetails(config.subject,config.publicKey,config.privateKey);
    const pending = db.prepare(`SELECT n.id,n.kind,n.title,n.href,s.id AS subscription_id,s.endpoint,s.p256dh,s.auth
      FROM notifications n JOIN push_subscriptions s ON s.player_id=n.player_id
      LEFT JOIN push_deliveries d ON d.notification_id=n.id AND d.subscription_id=s.id
      WHERE d.notification_id IS NULL AND n.read_at IS NULL AND n.created_at > s.created_at ORDER BY n.id LIMIT 50`).all() as Array<{id:number;kind:string;title:string;href:string;subscription_id:number;endpoint:string;p256dh:string;auth:string}>;
    let sent=0;
    for (const row of pending) {
      try {
        await webpush.sendNotification({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},
          JSON.stringify({title:row.title,href:row.href}),{TTL:60*60*12,timeout:10000});
        db.prepare('INSERT OR IGNORE INTO push_deliveries (notification_id,subscription_id,attempted_at) VALUES (?,?,?)').run(row.id,row.subscription_id,new Date().toISOString());
        sent++;
      } catch (cause) {
        const status = (cause as {statusCode?:number}).statusCode;
        if (status === 404 || status === 410) db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(row.subscription_id);
        else console.warn('[push] send failed',status ?? 'network error');
      }
    }
    return sent;
  } finally { sending=false; }
}
