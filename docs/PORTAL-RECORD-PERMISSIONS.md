# Portal native record permissions

The default-off local connector (`HS_PORTAL_RECORDS_ENABLED` with the existing writer gate) uses existing native collection, record and sensitive-field capability contracts. It does not infer authority from page/space or workspace roles.

Current explicit native Owner/Admin reviewer approval, Accounts tenant-administrator proof and native collection manage-permissions capability are all required. The authenticated Portal session UID is supplied server-side; the existing Accounts verifier requires that same suite session to have opened Holy Sheet. The configured tenant must be the exact mapped organisation UUID. Secrets remain in private runtime environment, never plans/receipts.

Preview captures exact native versions, target grants, current proof revision and resource catalogue. Apply requires the same snapshot, reserves a unique receipt and uses the native permission repository inside one PostgreSQL transaction. Self/owner mutations, stale reviews, unknown capabilities and replay deny. Permission and audit writes roll back if receipt persistence fails.

Collection/record grants are additive. Sensitive-field view/write/history is independent and defaults to deny. No record values enter this connector. Existing permission manager and native per-request authorization remain authoritative.

Record pages periodically recheck a no-values fingerprint, remounting the protected component on permission changes and removing it when verification fails. Pending old responses cannot repopulate a removed tree. Unchanged proof retains drafts.

Staging qualification exposed a pre-existing restart defect: historical capability constraints narrowed newer legitimate grants during schema replay. Historical expansions now retain an already-newer constraint. Tests reopen populated stores with all current native capabilities and reject unknown capabilities after replay; no existing grants are rewritten.
