/* global process, console */
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5175';
const productId = process.env.PRODUCT_ID ?? '8e2f5070-823a-41a4-be08-f19bb8cdbf60';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const responses = [];
page.on('response', async (response) => {
  const url = response.url();
  if (!url.includes('/rest/v1/')) return;
  if (!/(products|icps|audiences|jobs|product_profiles|audience_routes)/.test(url)) return;
  let body = '';
  try {
    body = (await response.text()).slice(0, 4000);
  } catch {
    body = '[response body unavailable]';
  }
  responses.push({ status: response.status(), url, body });
});
await page.goto(`${base}/auth`, { waitUntil: 'networkidle' });
await page.getByLabel('Email').fill(process.env.SALES_OS_EMAIL);
await page.getByLabel('Password').fill(process.env.SALES_OS_PASSWORD);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(/\/sales-os\//, { timeout: 15000 });
await page.goto(`${base}/sales-os/products/${productId}?step=audiences`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
console.log(JSON.stringify({ url: page.url(), text: await page.locator('main').innerText(), responses }, null, 2));
await browser.close();
