# Recipient-accepted Holy Sheet ownership handover

Staging candidate only; no deployment or migration. Both Portal APLYD_HS_OWNERSHIP_ENABLED and native HS_PORTAL_OWNERSHIP_ENABLED default off. Existing private writer, exact resource, reviewed issuer/subjects, current central super-admin and native Owner are required. The successor must already be an active native Administrator or Owner; this does not grant central administrator privileges.

Review pins current workspace version, reviewer/membership revision, exact source and successor, owned-page count and the native preview digest. Portal Save creates the existing native seven-day pending request and an atomic native receipt. It does not change ownership. Existing pending requests cannot be replaced through this editor. Replayed/stale reviews and uncertain outcomes are held.

The selected recipient accepts in Holy Sheet. Native acceptance atomically promotes that recipient to Owner, demotes the original Owner to Administrator and transfers the original owner's workspace pages. Page contents, revision history, identities and unrelated permissions remain unchanged. Portal receipt readback distinguishes pending/accepted/expired/revoked. The native existing-session guard rechecks roles immediately on the next request and refreshes the open UI.

Acceptance: real Accounts OIDC, two explicitly preseeded central reviewers, Portal request, recipient's native-browser acceptance, both original cookies retained, successor Portal downgrade of former Owner to Observer (old editor closes; write denies), then revoke (old page clears; original session denies). Preservation covers 445 native and 32 Portal tables, with only reviewed ownership/membership fields and expected audit/receipt counters excluded. Temporary PostgreSQL and tunnel were removed. No production data or credentials used.

The browser used the unchanged native web runtime from the parent candidate and this branch's compiled private connector. No native public route/UI files changed. The focused connector suite also ran against disposable PostgreSQL.

Full regression initially reproduced an existing date-expired page digest test on the unchanged parent. Its scheduled fixture dates now follow the next Monday after the database's real-time writes; assertions are unchanged. This is test-only and leaves digest behavior unchanged.

Detailed local evidence: work/aplyd-central-admin/native-session-e2e-20261109/hs-ownership-{acceptance.json,browser.log,cleanup.json,review.png}.
