// Real, unpaid API smoke check. Deliberately invalid login cannot name an account.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const BASE = process.env.TEST_BASE_URL || 'https://58019781e7eae9e76485bd0dc07c799f.62.60.238.183.nip.io';
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => localStorage.setItem('onboardingSeen', 'true'));
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 });
    await page.getByRole('textbox', { name: 'Логин', exact: true }).fill('audit-invalid-login!');
    await page.getByRole('textbox', { name: 'Пароль', exact: true }).fill('not-a-real-password');
    const response = page.waitForResponse(response => response.url().endsWith('/auth/login') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const actual = await response;
    assert.equal(actual.status(), 401);
    assert.equal(actual.headers()['access-control-allow-origin'], new URL(BASE).origin);
    await page.getByText('Неверный логин или пароль.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('authSession')), null);
    const statuses = await page.evaluate(async () => {
      const api = 'https://62.60.238.183.nip.io';
      const auth = await fetch(api + '/auth/me', { headers: { 'X-Session-Token': 'deliberately-invalid' } });
      const job = await fetch(api + '/tryon-jobs/audit-no-auth', { headers: { 'X-Session-Token': 'deliberately-invalid' } });
      return [auth.status, job.status];
    });
    assert.deepEqual(statuses, [401, 401]);
    console.log('PASS live API: browser POST/login and GET/auth+jobs pass CORS; invalid credentials remain rejected');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
