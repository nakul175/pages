import type { Page } from '@playwright/test';

/** Follow the compact document menu's visible search path. */
export async function choosePageAction(page: Page, name: string) {
  await page.getByLabel('Page options', { exact: true }).click();
  const menu = page.locator('.page-tools-menu');
  await menu.getByRole('textbox', { name: 'Find page action', exact: true }).fill(name);
  await menu.getByRole('button', { name, exact: true }).click();
}
