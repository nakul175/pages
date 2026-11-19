-- Empty/default-denied Portal reviewer registry. No identity or role backfill.
CREATE TABLE IF NOT EXISTS hs_portal_reviewers (
 workspace_id text NOT NULL REFERENCES hs_workspaces(id),
 issuer text NOT NULL,
 subject text NOT NULL REFERENCES hs_users(id),
 enabled boolean NOT NULL DEFAULT false,
 review_reference text NOT NULL CHECK (length(trim(review_reference))>0),
 PRIMARY KEY(workspace_id,issuer,subject)
);
ALTER TABLE hs_workspaces ADD COLUMN IF NOT EXISTS portal_access_revision bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS hs_portal_permission_receipts (
 request_id uuid PRIMARY KEY,
 workspace_id text NOT NULL REFERENCES hs_workspaces(id),
 actor_id text NOT NULL REFERENCES hs_users(id),
 target_id text NOT NULL REFERENCES hs_users(id),
 before_value jsonb NOT NULL,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Catch membership/reviewer changes including ABA changes made by other native
-- administration paths. This counter is not an application role or a grant.
CREATE OR REPLACE FUNCTION hs_portal_access_revision_bump() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN
  UPDATE hs_workspaces SET portal_access_revision=portal_access_revision+1 WHERE id=OLD.workspace_id;
 END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id) THEN
  UPDATE hs_workspaces SET portal_access_revision=portal_access_revision+1 WHERE id=NEW.workspace_id;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS hs_portal_members_revision ON hs_members;
CREATE TRIGGER hs_portal_members_revision AFTER INSERT OR UPDATE OR DELETE ON hs_members
 FOR EACH ROW EXECUTE FUNCTION hs_portal_access_revision_bump();
DROP TRIGGER IF EXISTS hs_portal_reviewers_revision ON hs_portal_reviewers;
CREATE TRIGGER hs_portal_reviewers_revision AFTER INSERT OR UPDATE OR DELETE ON hs_portal_reviewers
 FOR EACH ROW EXECUTE FUNCTION hs_portal_access_revision_bump();
