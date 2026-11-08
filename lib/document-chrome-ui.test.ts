import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const app = readFileSync(join(process.cwd(), "components/holy-sheet-app.tsx"), "utf8");
const css = readFileSync(join(process.cwd(), "app/workspace.css"), "utf8");

it("keeps only Share and the grouped document action menu in primary chrome", () => {
  expect(app).toContain('aria-label="Page options"');
  expect(app).toContain('data-category="content"');
  expect(app).toContain('data-category="governance"');
  expect(app).toContain('data-category="integrations"');
  expect(app.indexOf('className="share-primary"')).toBeLessThan(app.indexOf('className="page-tools"'));
  expect(css).toContain('.page-primary-actions > :not(.share-primary):not(.page-tools) { display:none; }');
  expect(css).toContain('.page-personal-actions > button { display:none; }');
  expect(css).toContain('.page-io-actions { display:none; }');
  expect(app).toContain('aria-label="Find page action"');
  expect(app).toContain('Browse all page actions');
});

it("puts the approved actions in their menu groups", () => {
  const content = app.indexOf('data-category="content"');
  const governance = app.indexOf('data-category="governance"');
  const integrations = app.indexOf('data-category="integrations"');
  expect(content).toBeGreaterThan(-1);
  expect(app.indexOf('Import a document', content)).toBeLessThan(governance);
  expect(app.slice(governance, integrations)).toContain('ref={setGovernanceTarget}');
  expect(app.indexOf('Document bundles', integrations)).toBeGreaterThan(integrations);
  expect(app.indexOf('Create SHO task', integrations)).toBeGreaterThan(integrations);
});
