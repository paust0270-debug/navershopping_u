/**
 * test-minimal.ts
 * msearch.shopping.naver.com 차단 원인 분리 진단
 *
 * 테스트 3개를 순차 실행:
 *   A) 순수 Patchright (수정 없음, 데스크톱)
 *   B) 모바일 에뮬레이션 + CDP 오버라이드 (현재 방식)
 *   C) 순수 Patchright에서 m.naver.com → 검색 → 쇼핑탭 클릭 (자연스러운 네비게이션)
 *
 * 실행: npx tsx shoppingtab/test-minimal.ts
 */

import { chromium } from "patchright";
import { applyMobileStealth, MOBILE_CONTEXT_OPTIONS, detectRealChrome, setupMobileCDP } from "../shared/mobile-stealth";
import * as fs from "fs";

const DIR = "./screenshots/test-minimal";
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function log(msg: string) {
  const t = new Date().toISOString().substring(11, 19);
  console.log(`[${t}] ${msg}`);
}

async function checkPage(page: any): Promise<string> {
  const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "");
  if (text.includes("일시적으로 제한") || text.includes("비정상적인 접근") || text.includes("접근이 제한")) return "BLOCKED";
  if (text.includes("보안 확인") || text.includes("영수증")) return "CAPTCHA";
  if (text.includes("장난감") || text.includes("상품")) return "OK";
  return `UNKNOWN: ${text.substring(0, 80)}`;
}

// ================================================================
//  테스트 A: 순수 Patchright — 아무 수정 없이 직접 접속
// ================================================================
async function testA() {
  log("\n========================================");
  log("  TEST A: 순수 Patchright (데스크톱, 수정 없음)");
  log("========================================");

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--window-size=480,960'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  try {
    // 먼저 m.naver.com으로 쿠키 획득
    log("[A] m.naver.com 접속 (쿠키 획득)");
    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded" });
    await sleep(2000);

    const cookies = await context.cookies();
    log(`[A] 쿠키 수: ${cookies.length}`);
    await page.screenshot({ path: `${DIR}/A-01-home.png` });

    // msearch.shopping.naver.com 직접 접속
    log("[A] msearch.shopping.naver.com 직접 접속");
    const resp = await page.goto("https://msearch.shopping.naver.com/search/all?query=장난감", {
      waitUntil: "domcontentloaded", timeout: 15000,
    });
    log(`[A] HTTP 상태: ${resp?.status()}`);
    await sleep(2000);

    const status = await checkPage(page);
    log(`[A] 결과: ${status}`);
    log(`[A] URL: ${page.url()}`);
    await page.screenshot({ path: `${DIR}/A-02-shopping.png` });

    // 핑거프린트
    const fp = await page.evaluate(() => ({
      ua: navigator.userAgent.substring(0, 80),
      platform: navigator.platform,
      mobile: (navigator as any).userAgentData?.mobile,
      brands: (navigator as any).userAgentData?.brands?.map((b: any) => `${b.brand}/${b.version}`),
      webdriver: (navigator as any).webdriver,
      touchPoints: navigator.maxTouchPoints,
    }));
    log(`[A] 핑거프린트: ${JSON.stringify(fp)}`);

    return status;
  } finally {
    await browser.close();
  }
}

// ================================================================
//  테스트 B: 모바일 에뮬레이션 + CDP (현재 route1 방식)
// ================================================================
async function testB() {
  log("\n========================================");
  log("  TEST B: 모바일 에뮬레이션 + CDP (현재 방식)");
  log("========================================");

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--window-size=480,960'],
  });

  const chrome = await detectRealChrome(browser);
  log(`[B] Chrome: v${chrome.majorVersion} | GREASE: "${chrome.greaseBrand}";v="${chrome.greaseVersion}"`);

  const { extraHTTPHeaders, userAgent: _ua, ...contextOpts } = MOBILE_CONTEXT_OPTIONS;
  const context = await browser.newContext({
    ...contextOpts,
    userAgent: chrome.mobileUA,
  });
  await applyMobileStealth(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const cdp = await context.newCDPSession(page);
  await setupMobileCDP(cdp, chrome);

  try {
    log("[B] m.naver.com 접속");
    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded" });
    await sleep(2000);
    await page.screenshot({ path: `${DIR}/B-01-home.png` });

    log("[B] msearch.shopping.naver.com 직접 접속");
    const resp = await page.goto("https://msearch.shopping.naver.com/search/all?query=장난감", {
      waitUntil: "domcontentloaded", timeout: 15000,
    });
    log(`[B] HTTP 상태: ${resp?.status()}`);
    await sleep(2000);

    const status = await checkPage(page);
    log(`[B] 결과: ${status}`);
    log(`[B] URL: ${page.url()}`);
    await page.screenshot({ path: `${DIR}/B-02-shopping.png` });

    const fp = await page.evaluate(() => ({
      ua: navigator.userAgent.substring(0, 80),
      platform: navigator.platform,
      mobile: (navigator as any).userAgentData?.mobile,
      brands: (navigator as any).userAgentData?.brands?.map((b: any) => `${b.brand}/${b.version}`),
      webdriver: (navigator as any).webdriver,
      touchPoints: navigator.maxTouchPoints,
    }));
    log(`[B] 핑거프린트: ${JSON.stringify(fp)}`);

    return status;
  } finally {
    await browser.close();
  }
}

// ================================================================
//  테스트 C: 순수 Patchright — 검색 → 쇼핑탭 자연 네비게이션
// ================================================================
async function testC() {
  log("\n========================================");
  log("  TEST C: 순수 Patchright — 검색→쇼핑탭 자연 네비게이션");
  log("========================================");

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--window-size=480,960'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  try {
    log("[C] m.naver.com 접속");
    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded" });
    await sleep(2000);
    await page.screenshot({ path: `${DIR}/C-01-home.png` });

    // 검색
    log("[C] 검색: 장난감");
    const fakeBar = await page.$("#MM_SEARCH_FAKE") || await page.$(".search_area");
    if (fakeBar) {
      await fakeBar.click();
      await sleep(800);
    }
    const input = await page.$("#query") || await page.$('input[name="query"]');
    if (!input) { log("[C] 검색 input 없음"); return "ERROR"; }
    await input.click();
    await sleep(200);
    await page.keyboard.type("장난감", { delay: 80 });
    await sleep(300);

    const nav1 = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
    await page.keyboard.press("Enter");
    await nav1;
    await sleep(2000);
    log(`[C] 검색 URL: ${page.url()}`);
    await page.screenshot({ path: `${DIR}/C-02-search.png` });

    // 쇼핑탭 찾기
    log("[C] 쇼핑탭 찾기");
    let tab = await page.$('a[href*="msearch.shopping.naver"]');
    if (!tab) {
      const links = await page.$$("a");
      for (const l of links) {
        const info = await l.evaluate((el: Element) => ({
          text: el.textContent?.trim() || "",
          href: el.getAttribute("href") || "",
        }));
        if (info.text.startsWith("쇼핑") && info.href.includes("shopping")) { tab = l; break; }
      }
    }
    if (!tab) { log("[C] 쇼핑탭 없음"); return "NO_TAB"; }

    const tabHref = await tab.evaluate((el: Element) => el.getAttribute("href") || "");
    log(`[C] 쇼핑탭 href: ${tabHref}`);

    // target 제거 후 클릭
    await tab.evaluate((el: HTMLElement) => el.removeAttribute("target"));
    log("[C] 쇼핑탭 클릭");
    const nav2 = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
    await tab.click();
    await nav2;
    await sleep(2000);

    const status = await checkPage(page);
    log(`[C] 결과: ${status}`);
    log(`[C] URL: ${page.url()}`);
    await page.screenshot({ path: `${DIR}/C-03-shopping.png` });

    return status;
  } finally {
    await browser.close();
  }
}

// ================================================================
//  메인
// ================================================================
async function main() {
  log("═══════════════════════════════════════════════");
  log("  msearch.shopping.naver.com 차단 원인 분리 진단");
  log("═══════════════════════════════════════════════");

  const resultA = await testA();
  await sleep(3000);

  const resultB = await testB();
  await sleep(3000);

  const resultC = await testC();

  log("\n═══════════════════════════════════════════════");
  log("  결과 요약:");
  log(`  A (순수 데스크톱):          ${resultA}`);
  log(`  B (모바일+CDP):             ${resultB}`);
  log(`  C (데스크톱 자연 네비):     ${resultC}`);
  log("═══════════════════════════════════════════════");

  if (resultA === "BLOCKED" && resultB === "BLOCKED" && resultC === "BLOCKED") {
    log("\n→ 모든 테스트 차단 = Patchright 자체가 탐지됨 또는 IP 차단");
    log("  다음 단계: IP 로테이션 후 시스템 Chrome (비자동화)으로 수동 접속 테스트");
  } else if (resultA === "OK" && resultB === "BLOCKED") {
    log("\n→ 모바일 에뮬레이션이 문제 = CDP 오버라이드 또는 init script 탐지");
  } else if (resultA === "BLOCKED" && resultC === "OK") {
    log("\n→ 직접 접속이 문제 = 자연 네비게이션 경로 필요");
  } else if (resultC === "OK") {
    log("\n→ 데스크톱+자연 네비게이션은 통과 = 이 방식으로 전환 고려");
  }

  log("\n스크린샷: screenshots/test-minimal/ 폴더 확인");
}

main().catch(console.error);
