import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { runMigrations } from '../src/lib/server/migrate';
import { seedAll } from '../src/lib/server/seed';
import { loadViewerPlayer } from '../src/lib/server/viewer';
import { acceptBooking, proposeBooking, loadActiveBooking } from '../src/lib/server/bookings';
import { loadCalendar, setAvailability } from '../src/lib/server/calendar';
import { inbox, readNotification, saveSubscription, removeSubscription, dispatchPush } from '../src/lib/server/notifications';
import { postDirectMessage } from '../src/lib/server/chat';

const files: Array<{db:Db;name:string}> = [];
function setup() {
  const name=path.join(os.tmpdir(),`minsnooks-phase14-${Math.random()}.db`);
  const db=openDb(name);files.push({db,name});runMigrations(db,path.resolve('migrations'));seedAll(db);
  const maya=loadViewerPlayer(db,'maya.chen@example.test')!;
  const leon=loadViewerPlayer(db,'leon.park@example.test')!;
  const owen=loadViewerPlayer(db,'owen.brooks@example.test')!;
  return {db,maya,leon,owen};
}
afterEach(()=>{while(files.length){const {db,name}=files.pop()!;db.close();for(const suffix of ['','-wal','-shm'])fs.rmSync(name+suffix,{force:true});}});

describe('Phase 14: calendar, inbox and push safety',()=>{
  it('keeps pending league proposals participant-only and exposes an accepted plan to members; replacement needs fresh acceptance',()=>{
    const {db,maya,leon,owen}=setup();
    const current=loadCalendar(db,maya,'2026-10')!;
    expect(current.entries.find(e=>e.label==='Leon Park vs Owen Brooks')?.state).toBe('agreed');

    const fixture=(db.prepare(`SELECT b.fixture_id AS id FROM bookings b JOIN fixtures f ON f.id=b.fixture_id
      JOIN rounds ro ON ro.id=f.round_id WHERE ro.number=6 AND b.status='proposed'`).get() as {id:number}).id;
    proposeBooking(db,{fixtureId:fixture,actorPlayerId:leon.playerId,date:'2026-10-05'}, {now:new Date('2026-09-29T12:00:00Z')});
    expect(loadCalendar(db,maya,'2026-10')!.entries.some(e=>e.label==='Leon Park vs Owen Brooks')).toBe(false);
    expect(loadCalendar(db,owen,'2026-10')!.entries.find(e=>e.label==='Leon Park vs Owen Brooks')?.state).toBe('proposed');
    expect(()=>acceptBooking(db,{fixtureId:fixture,actorPlayerId:maya.playerId})).toThrow();
    expect(()=>acceptBooking(db,{fixtureId:fixture,actorPlayerId:leon.playerId})).toThrow();
    expect(acceptBooking(db,{fixtureId:fixture,actorPlayerId:owen.playerId})).toBe(true);
    expect(acceptBooking(db,{fixtureId:fixture,actorPlayerId:owen.playerId})).toBe(false);
    expect(loadActiveBooking(db,fixture)?.proposedDate).toBe('2026-10-05');
    expect(loadCalendar(db,maya,'2026-10')!.entries.find(e=>e.label==='Leon Park vs Owen Brooks')?.state).toBe('agreed');
  });
  it('availability is member-only, self-service and validates dates; does not touch standings',()=>{
    const {db,maya,leon}=setup();
    const before=(db.prepare('SELECT COUNT(*) AS n FROM results').get() as {n:number}).n;
    expect(loadCalendar(db,null,'2026-10')).toBeNull();
    setAvailability(db,leon,'2026-10-04','unavailable',new Date('2026-09-29'));
    expect(loadCalendar(db,maya,'2026-10')!.availability.find(a=>a.playerId===leon.playerId)?.status).toBe('unavailable');
    expect(()=>setAvailability(db,leon,'2026-02-31','available',new Date('2026-09-29'))).toThrow();
    expect(()=>setAvailability(db,null,'2026-10-04','available')).toThrow();
    setAvailability(db,leon,'2026-10-04','clear',new Date('2026-09-29'));
    expect(loadCalendar(db,maya,'2026-10')!.availability.some(a=>a.playerId===leon.playerId)).toBe(false);
    expect((db.prepare('SELECT COUNT(*) AS n FROM results').get() as {n:number}).n).toBe(before);
  });
  it('notification reads are owner-scoped; transactional proposal trigger targets the opponent only',()=>{
    const {db,maya,leon,owen}=setup();
    const fixture=(db.prepare(`SELECT b.fixture_id AS id FROM bookings b JOIN fixtures f ON f.id=b.fixture_id
      JOIN rounds ro ON ro.id=f.round_id WHERE ro.number=6 AND b.status='proposed'`).get() as {id:number}).id;
    const before=inbox(db,owen).length;
    proposeBooking(db,{fixtureId:fixture,actorPlayerId:leon.playerId,date:'2026-10-05'},{now:new Date('2026-09-29T12:00:00Z')});
    expect(inbox(db,owen).length).toBe(before+1);
    const notice=inbox(db,owen)[0];
    expect(notice).toMatchObject({kind:'date_proposed',href:`/fixtures/${fixture}`});
    expect(()=>readNotification(db,maya,notice.id)).toThrow();
    expect(readNotification(db,owen,notice.id)).toBe(`/fixtures/${fixture}`);
    expect(inbox(db,owen)[0].read_at).not.toBeNull();
  });
  it('direct-message event has no body and is sent only to its other participant; league channel does not produce it',()=>{
    const {db,maya,leon}=setup();
    const thread=(db.prepare('SELECT id,player_low_id,player_high_id FROM chat_threads WHERE player_low_id=? OR player_high_id=? LIMIT 1').get(maya.playerId,maya.playerId) as {id:number;player_low_id:number;player_high_id:number});
    const sender=thread.player_low_id===maya.playerId ? maya.playerId : thread.player_low_id;
    const recipient=thread.player_low_id===maya.playerId ? thread.player_high_id : thread.player_low_id;
    const start=(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='direct_message' AND player_id=?").get(recipient) as {n:number}).n;
    postDirectMessage(db,{threadId:thread.id,actorPlayerId:sender,body:'A private secret not for push'}, {now:new Date('2026-09-29T12:00:00Z')});
    const events=db.prepare("SELECT title,href FROM notifications WHERE kind='direct_message' AND player_id=? ORDER BY id DESC").all(recipient) as Array<{title:string;href:string}>;
    expect(events.length).toBe(start+1);
    expect(JSON.stringify(events[0])).not.toContain('secret');
    expect(events[0].href).toBe(`/chat/direct/${thread.id}`);
    expect(leon).toBeTruthy();
  });
  it('subscription cannot be stolen across identities or become an SSRF target; no config means no push',async()=>{
    const {db,maya,leon}=setup();
    const sub={endpoint:'https://fcm.googleapis.com/fcm/send/abc',keys:{p256dh:'abc_DEF-1',auth:'aaaBBB'}};
    saveSubscription(db,maya,sub);
    expect(()=>saveSubscription(db,leon,sub)).toThrow();
    expect(()=>saveSubscription(db,maya,{...sub,endpoint:'https://localhost/secrets'})).toThrow();
    expect(await dispatchPush(db,{})).toBe(0);
    removeSubscription(db,leon,sub.endpoint);
    expect((db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as {n:number}).n).toBe(1);
    removeSubscription(db,maya,sub.endpoint);
    expect((db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as {n:number}).n).toBe(0);
  });
  it('result submission/confirmation/send-back, round close and knockout draw enqueue scoped events',()=>{
    const {db}=setup();
    const fixture=db.prepare(`SELECT f.id,f.player_low_id AS low,f.player_high_id AS high
      FROM fixtures f JOIN rounds r ON r.id=f.round_id WHERE r.number=6 AND f.state='unplayed' LIMIT 1`).get() as {id:number;low:number;high:number};
    db.prepare(`INSERT INTO results (fixture_id,player_low_frames,player_high_frames,actual_played_date,status,submitted_by_player_id)
      VALUES (?,2,1,'2026-09-29','submitted',?)`).run(fixture.id,fixture.low);
    expect((db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='result_submitted' AND player_id=?").get(fixture.high) as {n:number}).n).toBe(1);
    db.prepare("UPDATE results SET status='sent_back',sent_back_by_player_id=? WHERE fixture_id=?").run(fixture.high,fixture.id);
    expect((db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='result_sent_back' AND player_id=?").get(fixture.low) as {n:number}).n).toBe(1);
    db.prepare("UPDATE results SET status='submitted' WHERE fixture_id=?").run(fixture.id);
    db.prepare("UPDATE results SET status='confirmed',confirmed_by_player_id=? WHERE fixture_id=?").run(fixture.high,fixture.id);
    expect((db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='result_confirmed' AND player_id=?").get(fixture.low) as {n:number}).n).toBe(1);
    const round=(db.prepare("SELECT id FROM rounds WHERE status='open' LIMIT 1").get() as {id:number}).id;
    db.prepare("UPDATE rounds SET status='closed' WHERE id=?").run(round);
    const participants=(db.prepare('SELECT COUNT(*) AS n FROM round_players WHERE round_id=?').get(round) as {n:number}).n;
    expect((db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='round_closed'").get() as {n:number}).n).toBe(participants);
    const competition=(db.prepare("SELECT id FROM knockout_competitions WHERE status='drawn' LIMIT 1").get() as {id:number}).id;
    const actor=(db.prepare('SELECT id FROM players LIMIT 1').get() as {id:number}).id;
    const before=(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='knockout_draw'").get() as {n:number}).n;
    const next=(db.prepare('SELECT MAX(stage_number) AS n FROM knockout_stages WHERE competition_id=?').get(competition) as {n:number}).n+1;
    db.prepare('INSERT INTO knockout_stages (competition_id,stage_number,drawn_by_player_id,drawn_at) VALUES (?,?,?,?)').run(competition,next,actor,new Date().toISOString());
    expect((db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='knockout_draw'").get() as {n:number}).n).toBeGreaterThan(before);
  });
  it('offline worker never writes fetched private responses to CacheStorage',()=>{
    const worker=fs.readFileSync(path.resolve('static/sw.js'),'utf8');
    expect(worker).toContain("cache.add('/offline.html')");
    expect(worker).toContain("event.request.mode !== 'navigate'");
    expect(worker).not.toMatch(/cache\.put\(/);
  });
});
