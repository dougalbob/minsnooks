-- Phase 14: private member availability; explicit acceptance of league plans;
-- transactional, recipient-scoped notification inbox and opt-in push subscriptions.
CREATE TABLE availability (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK (status IN ('available', 'unavailable')),
  PRIMARY KEY (player_id, local_date)
);
CREATE INDEX idx_availability_date ON availability(local_date);

-- A proposal becomes accepted only when the OTHER participant explicitly agrees.
-- Superseding/cancelling a proposal keeps its historical acceptance but removes
-- it from the live calendar. A booked_date mirror remains only a plan, never play.
CREATE TABLE booking_acceptances (
  booking_id INTEGER PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  accepted_by_player_id INTEGER NOT NULL REFERENCES players(id),
  accepted_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('date_proposed','date_accepted','result_submitted','result_confirmed','result_sent_back','round_opened','round_closed','knockout_draw','direct_message')),
  title TEXT NOT NULL,
  href TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at TEXT
);
CREATE INDEX idx_notifications_player ON notifications(player_id,id DESC);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_push_subscriptions_player ON push_subscriptions(player_id);
CREATE TABLE push_deliveries (
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  attempted_at TEXT NOT NULL,
  PRIMARY KEY (notification_id,subscription_id)
);

-- Triggers run inside the originating transaction: no orphan events on rollback.
-- Keep private data out of titles/URLs. Never notify the actor of their own act.
CREATE TRIGGER notify_booking_proposed AFTER INSERT ON bookings WHEN NEW.status = 'proposed' BEGIN
  INSERT INTO notifications (player_id,kind,title,href)
  SELECT CASE WHEN f.player_low_id = NEW.proposed_by_player_id THEN f.player_high_id ELSE f.player_low_id END,
    'date_proposed','New league date proposal','/fixtures/' || f.id
  FROM fixtures f WHERE f.id=NEW.fixture_id;
END;
CREATE TRIGGER notify_booking_accepted AFTER INSERT ON booking_acceptances BEGIN
  INSERT INTO notifications (player_id,kind,title,href)
  SELECT b.proposed_by_player_id,'date_accepted','League date agreed','/fixtures/' || b.fixture_id
  FROM bookings b WHERE b.id=NEW.booking_id AND b.proposed_by_player_id<>NEW.accepted_by_player_id;
END;
CREATE TRIGGER notify_result_insert AFTER INSERT ON results WHEN NEW.status='submitted' BEGIN
  INSERT INTO notifications (player_id,kind,title,href)
  SELECT CASE WHEN f.player_low_id=NEW.submitted_by_player_id THEN f.player_high_id ELSE f.player_low_id END,
    'result_submitted','Result awaiting your review','/fixtures/' || f.id
  FROM fixtures f WHERE f.id=NEW.fixture_id AND NEW.submitted_by_player_id IN (f.player_low_id,f.player_high_id);
END;
CREATE TRIGGER notify_result_update AFTER UPDATE OF status ON results WHEN NEW.status<>OLD.status BEGIN
  INSERT INTO notifications (player_id,kind,title,href)
  SELECT NEW.submitted_by_player_id,
    CASE NEW.status WHEN 'confirmed' THEN 'result_confirmed' ELSE 'result_sent_back' END,
    CASE NEW.status WHEN 'confirmed' THEN 'Result confirmed' ELSE 'Result sent back for correction' END,
    '/fixtures/' || NEW.fixture_id
  WHERE NEW.status IN ('confirmed','sent_back');
  INSERT INTO notifications (player_id,kind,title,href)
  SELECT CASE WHEN f.player_low_id=NEW.submitted_by_player_id THEN f.player_high_id ELSE f.player_low_id END,
    'result_submitted','Result awaiting your review','/fixtures/' || f.id
  FROM fixtures f WHERE f.id=NEW.fixture_id AND NEW.status='submitted'
    AND NEW.submitted_by_player_id IN (f.player_low_id,f.player_high_id);
END;
CREATE TRIGGER notify_round_close AFTER UPDATE OF status ON rounds WHEN OLD.status='open' AND NEW.status='closed' BEGIN
  INSERT INTO notifications (player_id,kind,title,href)
  SELECT rp.player_id,'round_closed','League round completed','/fixtures'
  FROM round_players rp WHERE rp.round_id=NEW.id;
END;
CREATE TRIGGER notify_knockout_draw AFTER INSERT ON knockout_stages BEGIN
  INSERT INTO notifications (player_id,kind,title,href)
  SELECT e.player_id,'knockout_draw','New knockout draw is ready','/knockout'
  FROM knockout_entries e WHERE e.competition_id=NEW.competition_id AND e.entry_status='selected';
END;
CREATE TRIGGER notify_dm AFTER INSERT ON chat_messages WHEN NEW.thread_id IS NOT NULL BEGIN
  INSERT INTO notifications (player_id,kind,title,href,created_at)
  SELECT CASE WHEN t.player_low_id=NEW.author_player_id THEN t.player_high_id ELSE t.player_low_id END,
    'direct_message','New direct message','/chat/direct/' || t.id, NEW.created_at
  FROM chat_threads t WHERE t.id=NEW.thread_id;
END;
