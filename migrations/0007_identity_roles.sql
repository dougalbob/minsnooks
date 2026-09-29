-- Phase 8: Identity, roles & contact visibility
-- Add optional phone number to players for contact details.
-- contact_visible already exists on players (default 1 = visible to league members).

ALTER TABLE players ADD COLUMN phone TEXT DEFAULT NULL;
