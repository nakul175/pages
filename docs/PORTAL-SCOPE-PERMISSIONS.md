# Holy Sheet native scope editor — staging only

This privileged local connector extends the existing reviewed workspace connector with `scope_inventory`, `scope_preview` and `scope_apply`. Both HS_PORTAL_WRITER_ENABLED and HS_PORTAL_SCOPES_ENABLED must be explicitly enabled; the central Portal gate is separately default off. Operator pins the issuer, workspace and database. There is no new public mutation endpoint or migration.

Central super-admin status is not sufficient native authority. A current native workspace Owner/Administrator needs an explicit enabled reviewer record; the target needs an existing active membership. Self and workspace-owner changes are denied. Page sharing also requires the actual page owner. Native space management and sharing functions enforce their existing rules in the same locked transaction as the durable receipt.

Space roles are native Leader/Editor/Viewer; page roles are native Editor/Commenter/Viewer. Removing a direct grant preserves separate and inherited access. Observer remains read-only despite a stronger page grant. Page ownership, record policy, additional workspace enrollment and shared role definitions are out of this bounded scope.

Reviews bind exact native identity, resource, current role, actor authority, workspace counters, native inheritance and resource version. Replays and stale plans deny. Native operation/audit/grant and Portal receipt changes are transactional; receipt failure rolls everything back. The central coordinator durably reserves before native I/O and holds an uncertain result instead of retrying it. Native readback and fresh preview must agree before success is shown.

Browser acceptance uses an owned PostgreSQL fixture, actual Accounts OIDC and Portal Create/Save. All production code, sessions, user data and configuration remain untouched. Evidence lives in work/aplyd-central-admin/native-session-e2e-20261108/HS-DEEP-PERMISSIONS-ACCEPTANCE.md. No production activation is implied.
