# Reviewed Portal workspace membership

This is an opt-in local OS connector for the current Pages implementation. It
does not expose a new HTTP mutation endpoint. `HS_PORTAL_WRITER_ENABLED=1`, an
explicit native reviewer row and current native Owner/Administrator authority
are all required. The reviewer registry starts empty. No identities, roles or
grants are inferred from email or Portal management scope.

Build with `node scripts/build-portal-permissions.mjs`. The resulting executable
requires the existing dependencies and an explicitly configured
`HS_PORTAL_DATABASE_URL`, `HS_IDENTITY_ISSUER`, `HS_PORTAL_WORKSPACE_ID` and optional
`PGSSL=require`. It reads one bounded JSON request from stdin and emits a bounded
JSON result. The process is limited to 15 seconds. It does not run migrations,
create accounts, load a dotenv file or fall back to a developer database.
Deploying it requires a reviewed database migration separately; none is enabled
by this change. The privileged OS/database account is a trust boundary.

Preview/apply use exact OIDC subjects, which the current native authenticator
uses as `hs_users.id`. They require existing workspace memberships, an exact
issuer and a reviewed native row in `hs_portal_reviewers`. They never use a
Portal organisation UUID as a native workspace ID. Self-changes and native
Owner targets/Owner grants are held for the existing ownership-transfer flow.

Apply locks the workspace before memberships/reviewer, checks the entire native
preview and monotonic membership/reviewer revision, and calls the existing
`previewMemberChange` / `changeWorkspaceMember` functions within that same
transaction. Native policy, attribution, audit and owner/last-admin protection
remain authoritative. Its durable receipt is committed in the same transaction;
a receipt failure rolls the mutation back. Reused request IDs are rejected.

Administrator grants workspace-wide page access, including private pages.
Member retains separate page grants. Observer is read-only wherever a grant
exists. Revoke sets only workspace membership inactive; it retains users,
page ownership/content, grants, space roles and other workspaces. Native request
checks and the existing active-page monitor apply role changes to open pages.
Explicit regrant can restore the same still-valid session's retained grants;
this is workspace revocation, not global suite-session logout.

Space roles, page grants, structured-record/tenant authority, invitation
acceptance, new account provisioning and app-assignment changes are separate
contracts. This connector does not certify or change them. Production stays
unchanged and all activation settings default off.

Migration 137 is additive and preserves existing records. Do not erase receipt
history or reset revision counters during rollback. A code rollback with the
writer disabled leaves these additive tables inert; actual rollback requires
fresh backup/restore evidence before any future production activation.
