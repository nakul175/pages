-- A reversible page archive, separate from the 30-day Trash lifecycle.
ALTER TABLE hs_pages ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS hs_pages_active_tree ON hs_pages(workspace_id,space_id,parent_id,position) WHERE archived_at IS NULL AND deleted_at IS NULL;
