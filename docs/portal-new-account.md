# Portal-created Holy Sheet accounts

Staging candidate only. The private permission connector accepts `provision_preview` and `provision_apply` only when both `HS_PORTAL_WRITER_ENABLED=1` and the separate `HS_PORTAL_PROVISIONING_ENABLED=1` are set. No public provisioning HTTP route or automatic login-time creation is added.

The Portal must supply the already verified central subject, exact configured issuer/workspace, current reviewed native owner/admin and a signed creation review. The native subject is the central subject itself, never an email lookup. Creation rejects an existing native user, even if absent from this workspace, and rejects dormant direct page grants/invitations for the proposed subject. It creates an Observer with no direct page/space grants. Observer can only read content made available by native grants; it does not gain administrator access.

Creation uses a locked workspace, subject advisory lock, current reviewer checks and an exact plan comparison. Native user, membership, access-version bump and durable receipt commit together. Replays, stale reviews and concurrent creation do not create a second account. Receipt failure rolls back all native writes. Existing workspace-role editing subsequently applies normal native semantics and preserves page grants/content. Owner/space/page/record editors remain separate work.

Apply the additive `138_portal_provisioning.sql` only to an approved isolated database for qualification. Production migration or enabling this writer requires a separate reviewed release; this branch does neither. The CLI never runs migrations or imports passwords. The matching Portal creates its durable reservation before native I/O, holds uncertain outcomes, and publishes application access only after native and Accounts readback.

Tests: `lib/portal-provisioning.test.ts` and `lib/portal-provisioning.postgres.test.ts`. The real PostgreSQL tests require the dedicated loopback `holy_sheet_acceptance` database and run in the existing validation workflow. Browser evidence is maintained separately with the Portal candidate; unit tests alone do not certify first login.
