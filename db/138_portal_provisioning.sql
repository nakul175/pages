-- No user/role backfill. Receipt for an explicitly reviewed new central subject.
CREATE TABLE IF NOT EXISTS hs_portal_provision_receipts (
 request_id uuid PRIMARY KEY,
 workspace_id text NOT NULL REFERENCES hs_workspaces(id),
 issuer text NOT NULL,
 actor_id text NOT NULL REFERENCES hs_users(id),
 target_id text NOT NULL UNIQUE REFERENCES hs_users(id),
 before_value jsonb NOT NULL,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
