/**
 * MID로 smartstore/brand URL 찾기
 */

import { chromium } from "patchright";

const nvMid = "89777026061";

async function findUrl() {
  console.log("MID:", nvMid);

  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--window-size=450,800"]
  });

  const ctx = await browser.newContext({
    viewport: { width: 412, height: 800 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36"
  });

  const page = await ctx.newPage();

  const url = `https://m.shopping.naver.com/products/${nvMid}`;
  console.log("접근 URL:", url);

  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log("\n최종 URL:", page.url());

  const finalUrl = page.url();

  // smartstore 확인
  const smartMatch = finalUrl.match(/smartstore\.naver\.com\/([^\/]+)\/products\/(\d+)/);
  if (smartMatch) {
    console.log("\n=== SMARTSTORE ===");
    console.log("storeId:", smartMatch[1]);
    console.log("productId:", smartMatch[2]);
  }

  // brand 확인
  const brandMatch = finalUrl.match(/brand\.naver\.com\/([^\/]+)\/products\/(\d+)/);
  if (brandMatch) {
    console.log("\n=== BRAND ===");
    console.log("brandId:", brandMatch[1]);
    console.log("productId:", brandMatch[2]);
  }

  await page.waitForTimeout(3000);
  await browser.close();
}

findUrl();
