/**
 * debug-shopping.ts
 * msearch.shopping.naver.com 418 원인 진단
 *
 * 1) m.naver.com 쿠키 획득
 * 2) msearch.shopping.naver.com 직접 접속 테스트
 * 3) 검색 → 쇼핑탭 네비게이션 테스트
 * 4) 모든 요청/응답 헤더 캡처
 */

import { chromium, type Page, type BrowserContext } from "patchright";
import { applyMobileStealth, MOBILE_CONTEXT_OPTIONS } from "../shared/mobile-stealth";
import * as fs from "fs";

const SCREENSHOT_DIR = "./screenshots/debug-shopping";
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function log(msg: string) {
  const t = new Date().toISOString().substring(11, 19);
  console.log(`[${t}] ${msg}`);
}

async function main() {
  log("=== msearch.shopping.naver.com 418 진단 시작 ===");

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--window-size=480,960'],
  });
  // extraHTTPHeaders의 sec-ch-ua 제거 — Chrome 자체 값 사용 (헤더/JS 불일치 방지)
  const { extraHTTPHeaders, ...contextOpts } = MOBILE_CONTEXT_OPTIONS;
  const context = await browser.newContext(contextOpts);
  await applyMobileStealth(context);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const cdp = await context.newCDPSession(page);

  // CDP로 navigator.platform + userAgentData(Client Hints) 전부 설정
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: MOBILE_CONTEXT_OPTIONS.userAgent,
    platform: 'Linux armv81',
    userAgentMetadata: {
      brands: [
        { brand: 'Chromium', version: '144' },
        { brand: 'Google Chrome', version: '144' },
        { brand: 'Not)A;Brand', version: '99' },
      ],
      fullVersionList: [
        { brand: 'Chromium', version: '144.0.0.0' },
        { brand: 'Google Chrome', version: '144.0.0.0' },
        { brand: 'Not)A;Brand', version: '99.0.0.0' },
      ],
      fullVersion: '144.0.0.0',
      platform: 'Android',
      platformVersion: '14.0.0',
      architecture: 'arm',
      model: 'SM-S911B',
      mobile: true,
      bitness: '64',
      wow64: false,
    },
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 5,
  });

  // ========== 요청/응답 로깅 ==========
  const requestLog: any[] = [];

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('shopping.naver') || url.includes('search.naver')) {
      const headers = req.headers();
      requestLog.push({
        type: 'REQUEST',
        url: url.substring(0, 120),
        method: req.method(),
        headers: {
          'user-agent': headers['user-agent']?.substring(0, 80),
          'sec-ch-ua': headers['sec-ch-ua'],
          'sec-ch-ua-mobile': headers['sec-ch-ua-mobile'],
          'sec-ch-ua-platform': headers['sec-ch-ua-platform'],
          'sec-fetch-dest': headers['sec-fetch-dest'],
          'sec-fetch-mode': headers['sec-fetch-mode'],
          'sec-fetch-site': headers['sec-fetch-site'],
          'sec-fetch-user': headers['sec-fetch-user'],
          'referer': headers['referer'],
          'cookie': headers['cookie'] ? `[${headers['cookie'].length} chars]` : '(none)',
        },
      });
    }
  });

  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('shopping.naver') || url.includes('search.naver')) {
      const headers = res.headers();
      requestLog.push({
        type: 'RESPONSE',
        url: url.substring(0, 120),
        status: res.status(),
        headers: {
          'content-type': headers['content-type'],
          'set-cookie': headers['set-cookie'] ? '[present]' : '(none)',
          'location': headers['location'],
          'x-frame-options': headers['x-frame-options'],
        },
      });
      // 418이면 바로 로그
      if (res.status() === 418) {
        log(`🚨 418 DETECTED: ${url.substring(0, 100)}`);
      }
    }
  });

  try {
    // ========== 테스트 1: m.naver.com 접속 (쿠키 획득) ==========
    log("\n[TEST 1] m.naver.com 접속 (쿠키 획득)");
    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded" });
    await sleep(2000);

    const cookies1 = await context.cookies();
    log(`  쿠키 수: ${cookies1.length}`);
    log(`  주요 쿠키: ${cookies1.map(c => c.name).join(', ')}`);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-home.png` });

    // ========== 테스트 2: msearch.shopping.naver.com 직접 접속 ==========
    log("\n[TEST 2] msearch.shopping.naver.com 직접 접속");
    const resp2 = await page.goto("https://msearch.shopping.naver.com/search/all?query=장난감", {
      waitUntil: "domcontentloaded", timeout: 15000
    });
    log(`  HTTP 상태: ${resp2?.status()}`);
    await sleep(2000);

    const bodyText2 = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || "");
    log(`  본문: ${bodyText2.substring(0, 100)}`);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-shopping-direct.png` });

    const cookies2 = await context.cookies();
    log(`  쿠키 수: ${cookies2.length} (새로 추가된: ${cookies2.length - cookies1.length})`);

    // ========== 테스트 3: 뒤로가기 후 검색 → 쇼핑탭 경로 ==========
    log("\n[TEST 3] m.naver.com → 검색 → 쇼핑탭 경로");
    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded" });
    await sleep(1500);

    // 검색
    const fakeBar = await page.$("#MM_SEARCH_FAKE") || await page.$(".search_area");
    if (fakeBar) {
      const box = await fakeBar.evaluate((el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.touchscreen.tap(box.x, box.y);
      await sleep(800);
    }
    const input = await page.$("#query") || await page.$('input[name="query"]');
    if (input) {
      await input.click();
      await sleep(200);
      for (const c of "장난감") { await page.keyboard.type(c, { delay: rand(60, 140) }); }

      const nav = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
      await page.keyboard.press("Enter");
      await nav;
      await sleep(2000);
      log(`  검색결과 URL: ${page.url()}`);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/03-search.png` });

      // 쇼핑탭 클릭
      let tab = await page.$('a[href*="msearch.shopping.naver"]');
      if (!tab) {
        const links = await page.$$("a");
        for (const l of links) {
          const info = await l.evaluate((el: Element) => ({ text: el.textContent?.trim() || "", href: el.getAttribute("href") || "" }));
          if (info.text.startsWith("쇼핑") && info.href.includes("shopping")) { tab = l; break; }
        }
      }

      if (tab) {
        // 쇼핑탭 href 확인
        const tabHref = await tab.evaluate((el: Element) => el.getAttribute("href") || "");
        log(`  쇼핑탭 href: ${tabHref}`);

        await tab.evaluate((el: HTMLElement) => el.removeAttribute("target"));
        const tabBox = await tab.evaluate((el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; });

        log("  쇼핑탭 클릭...");
        const nav2 = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
        if (tabBox) await page.touchscreen.tap(tabBox.x, tabBox.y); else await tab.click();
        await nav2;
        await sleep(2000);

        const resp3Status = await page.evaluate(() => {
          // Check for block indicators
          const t = document.body?.innerText || "";
          if (t.includes("일시적으로 제한")) return "BLOCKED";
          if (t.includes("보안 확인")) return "CAPTCHA";
          return "OK";
        });
        log(`  쇼핑탭 결과: ${resp3Status}`);
        log(`  URL: ${page.url()}`);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/04-shopping-tab.png` });

        const cookies3 = await context.cookies();
        log(`  쿠키 수: ${cookies3.length}`);
      } else {
        log("  쇼핑탭 없음");
      }
    }

    // ========== 테스트 4: navigator 핑거프린트 확인 ==========
    log("\n[TEST 4] 브라우저 핑거프린트 확인");
    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded" });
    await sleep(1000);

    const fingerprint = await page.evaluate(() => {
      return {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        webdriver: (navigator as any).webdriver,
        maxTouchPoints: navigator.maxTouchPoints,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: (navigator as any).deviceMemory,
        userAgentData: (navigator as any).userAgentData ? {
          mobile: (navigator as any).userAgentData.mobile,
          platform: (navigator as any).userAgentData.platform,
          brands: (navigator as any).userAgentData.brands,
        } : 'undefined',
        connection: (navigator as any).connection ? {
          effectiveType: (navigator as any).connection.effectiveType,
          type: (navigator as any).connection.type,
        } : 'undefined',
        languages: navigator.languages,
        cookieEnabled: navigator.cookieEnabled,
      };
    });
    log(`  핑거프린트:\n${JSON.stringify(fingerprint, null, 2)}`);

  } catch (e: any) {
    log(`ERROR: ${e.message}`);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/99-error.png` }).catch(() => {});
  }

  // ========== 요청/응답 로그 출력 ==========
  log("\n=== 요청/응답 로그 ===");
  for (const entry of requestLog) {
    log(`\n[${entry.type}] ${entry.status || entry.method} ${entry.url}`);
    for (const [k, v] of Object.entries(entry.headers)) {
      if (v && v !== '(none)') log(`  ${k}: ${v}`);
    }
  }

  log("\n=== 진단 완료. 브라우저 유지 중. Ctrl+C 종료 ===");
  await new Promise(() => {});
}

main().catch(console.error);
