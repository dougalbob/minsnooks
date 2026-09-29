-- Phase 7: queryable award-review queue. Review state itself is append-only in
-- audit_log (award_review_needed / award_reviewed); this index serves the queue
-- without adding mutable workflow state to the source result or award.
CREATE INDEX idx_audit_award_review_queue
	ON audit_log(action, entity_type, entity_id, id DESC);
