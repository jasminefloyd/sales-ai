/* global process, console, document */
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5175';
const productId = process.env.PRODUCT_ID ?? '8e2f5070-823a-41a4-be08-f19bb8cdbf60';
const email = process.env.SALES_OS_EMAIL;
const password = process.env.SALES_OS_PASSWORD;
if (!email || !password) throw new Error('Set SALES_OS_EMAIL and SALES_OS_PASSWORD');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const consoleMessages = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') consoleMessages.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.goto(`${base}/auth`, { waitUntil: 'networkidle' });
await page.getByLabel('Email').fill(email);
await page.getByLabel('Password').fill(password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(/\/sales-os\//, { timeout: 15000 });
await page.goto(`${base}/sales-os/products/${productId}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const steps = ['Source', 'Sales profile', 'Audiences', 'Outreach', 'Copy'];
const results = [];
for (const step of steps) {
  const button = page.getByRole('button', { name: new RegExp(`^${step}`) }).first();
  await button.click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `/tmp/sales-os-${step.toLowerCase().replaceAll(' ', '-')}.png`, fullPage: true });
  const metrics = await page.evaluate(() => {
    return ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    disclosures: [...document.querySelectorAll('.pw-disc-btn')].map((el) => ({ expanded: el.getAttribute('aria-expanded'), width: el.getBoundingClientRect().width, parent: el.parentElement?.getBoundingClientRect().width })),
    panels: document.querySelectorAll('main .pw-panel').length,
    panelIcons: document.querySelectorAll('main .pw-panel > .pw-panel-head .pw-panel-icon').length,
    banned: [...document.querySelectorAll('main')].map((el) => el.innerText).join('\n').match(/deterministic|persisted|fallback|provider|human review|0 ICPs|\.\.\.|Evidence:|Operational quality|Intent score|Review ICPs|Versioned ICP|Audience strategy|Generated copy|Copy review/gi) ?? [],
    });
  });
  results.push({ step, metrics });
}
console.log(JSON.stringify({ url: page.url(), results, consoleMessages, pageErrors }, null, 2));
await browser.close();
