/**
 * shopping-test-standalone.ts
 *
 * 독립 테스트: m.naver.com → "장난감" 검색 → 쇼핑탭 → 2번째 상품 상세페이지 진입
 *
 * 실행: npx tsx shopping-test-standalone.ts
 * 환경: Windows + puppeteer-real-browser
 *
 * 전략:
 *   A) m.naver.com → 통합검색 → 쇼핑탭 클릭 → 상품 클릭
 *   B) (폴백) m.naver.com → 스토어 링크 → 쇼핑홈 검색 → 상품 클릭
 *
 * 봇탐지 우회:
 *   - CDP Fetch 인터셉트: 모든 document 요청에 Sec-Fetch-User: ?1 주입
 *   - Sec-Fetch-Site 동적 계산 (none/same-origin/same-site/cross-site)
 *   - 모바일 UA + 터치 + 인간화 타이핑/스크롤
 */

import { connect } from "puppeteer-real-browser";
import type { Page, Browser } from "puppeteer-core";
import * as fs from "fs";

// ============ 설정 ============
const KEYWORD = "장난감";
const TARGET_PRODUCT_INDEX = 2;   // N번째 상품 (1-based, 광고 제외)
const SCREENSHOT_DIR = "./screenshots";
const HEADLESS = false;
const CLOSE_BROWSER_ON_END = false; // false: 테스트 후 브라우저 유지 (결과 확인용)

// 모바일 디바이스 (Galaxy S24 Ultra)
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const MOBILE_VIEWPORT = {
  width: 412,
  height: 915,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
};

// ============ 유틸 ============
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function log(msg: string, level: "info" | "warn" | "error" = "info") {
  const time = new Date().toISOString().substring(11, 19);
  const tag = { info: "INFO", warn: "WARN", error: "FAIL" }[level];
  console.log(`[${time}] [${tag}] ${msg}`);
}

// 스크린샷 디렉토리
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function snap(page: Page, name: string): Promise<void> {
  try {
    const p = `${SCREENSHOT_DIR}/${name}-${Date.now()}.png`;
    await page.screenshot({ path: p });
    log(`📸 ${p}`);
  } catch {}
}

// ============ Sec-Fetch-Site 동적 계산 ============
function calcSecFetchSite(requestUrl: string, pageUrl: string): string {
  if (!pageUrl || pageUrl === "about:blank" || pageUrl.startsWith("chrome")) return "none";
  try {
    const rHost = new URL(requestUrl).hostname;
    const pHost = new URL(pageUrl).hostname;
    if (rHost === pHost) return "same-origin";
    // same-site: 같은 등록 도메인 (naver.com ↔ m.naver.com ↔ shopping.naver.com)
    const rDomain = rHost.split(".").slice(-2).join(".");
    const pDomain = pHost.split(".").slice(-2).join(".");
    if (rDomain === pDomain) return "same-site";
    return "cross-site";
  } catch {
    return "cross-site";
  }
}

// ============ CDP Fetch 인터셉트 ============
// 정상 사용자의 네트워크 요청을 완벽 모사
async function setupCDPIntercept(page: Page, cdp: any): Promise<void> {
  // Document 요청만 인터셉트 (이미지/스크립트는 브라우저가 자동으로 처리)
  await cdp.send("Fetch.enable", {
    patterns: [{ requestStage: "Request", resourceType: "Document" }],
  });

  let currentPageUrl = page.url();

  // frame navigation 추적
  page.on("framenavigated", (frame: any) => {
    try {
      if (frame === page.mainFrame()) currentPageUrl = frame.url();
    } catch {}
  });

  cdp.on("Fetch.requestPaused", async (ev: any) => {
    try {
      const reqUrl = ev.request.url;
      const headers = ev.request.headers;

      // 기존 Sec-Fetch-* 전부 제거
      const cleaned = Object.entries(headers)
        .filter(([k]) => !k.toLowerCase().startsWith("sec-fetch"))
        .map(([name, value]) => ({ name, value: String(value) }));

      const site = calcSecFetchSite(reqUrl, currentPageUrl);

      // 정상 사용자 헤더 세트 주입
      const injected = [
        ...cleaned,
        { name: "Sec-Fetch-Dest", value: "document" },
        { name: "Sec-Fetch-Mode", value: "navigate" },
        { name: "Sec-Fetch-Site", value: site },
        { name: "Sec-Fetch-User", value: "?1" },
      ];

      // Upgrade-Insecure-Requests 보장
      if (!injected.find((h) => h.name.toLowerCase() === "upgrade-insecure-requests")) {
        injected.push({ name: "Upgrade-Insecure-Requests", value: "1" });
      }

      log(`[CDP] Sec-Fetch-Site=${site}  ${reqUrl.substring(0, 90)}`);

      await cdp.send("Fetch.continueRequest", {
        requestId: ev.requestId,
        headers: injected,
      });
    } catch {
      try {
        await cdp.send("Fetch.continueRequest", { requestId: ev.requestId });
      } catch {}
    }
  });

  log("CDP Fetch 인터셉트 활성화 (Document 요청 → Sec-Fetch-User: ?1 주입)");
}

// ============ 모바일 스텔스 주입 ============
async function injectMobileStealth(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    // navigator.webdriver 제거
    Object.defineProperty(navigator, "webdriver", { get: () => false });

    // 모바일 플랫폼
    Object.defineProperty(navigator, "platform", { get: () => "Linux armv8l" });
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });

    // navigator.connection (모바일 LTE)
    if (!(navigator as any).connection) {
      Object.defineProperty(navigator, "connection", {
        get: () => ({
          effectiveType: "4g",
          rtt: 50,
          downlink: 10,
          saveData: false,
        }),
      });
    }

    // permissions query 우회
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      (window.navigator.permissions as any).query = (params: any) =>
        params.name === "notifications"
          ? Promise.resolve({ state: Notification.permission } as any)
          : originalQuery.call(window.navigator.permissions, params);
    }
  });
}

// ============ 인간화 타이핑 ============
async function humanType(page: Page, text: string): Promise<void> {
  for (const char of text) {
    await page.keyboard.type(char, { delay: rand(60, 140) });
    await sleep(rand(20, 70));
  }
}

// ============ CDP 터치 스크롤 ============
async function touchScroll(cdp: any, page: Page, distance: number): Promise<void> {
  const vp = page.viewport();
  const x = vp ? Math.floor(vp.width / 2) : 200;
  const y = vp ? Math.floor(vp.height / 2) : 400;

  let scrolled = 0;
  while (scrolled < distance) {
    const step = rand(200, 400);
    try {
      await cdp.send("Input.synthesizeScrollGesture", {
        x,
        y,
        yDistance: -Math.floor(step),
        xDistance: 0,
        speed: Math.floor(rand(800, 1200)),
        gestureSourceType: "touch",
        repeatCount: 1,
        repeatDelayMs: 0,
      });
    } catch {
      await page.evaluate((s: number) => window.scrollBy(0, s), step).catch(() => {});
    }
    scrolled += step;
    await sleep(rand(100, 250));
    // 간헐적 체류
    if (Math.random() < 0.15) await sleep(rand(300, 700));
  }
}

// ============ 접근 차단 / CAPTCHA 감지 ============
async function checkPageStatus(page: Page): Promise<"ok" | "captcha" | "blocked"> {
  const result = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    const blockedPatterns = ["비정상적인 접근", "자동화된 접근", "이용이 제한", "비정상적인 요청"];
    const captchaPatterns = ["보안 확인", "자동입력방지", "캡차"];

    if (blockedPatterns.some((p) => text.includes(p))) return "blocked";
    if (text.includes("접근이 제한") && text.includes("잠시 후")) return "blocked";
    if (captchaPatterns.some((p) => text.includes(p))) return "captcha";
    return "ok";
  });
  return result as "ok" | "captcha" | "blocked";
}

// ================================================================
//  접근 A: m.naver.com → 통합검색 → 쇼핑탭 → 2번째 상품
// ================================================================
async function approachA(page: Page, cdp: any): Promise<boolean> {
  log("━━━ 접근 A: 통합검색 → 쇼핑탭 ━━━");

  // ── STEP 1: m.naver.com 접속 ──
  log("[A-1] m.naver.com 접속");
  await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(rand(1500, 2500));

  // ★ 즉시 CAPTCHA/차단 체크
  const status0 = await checkPageStatus(page);
  if (status0 !== "ok") {
    log(`  m.naver.com 상태: ${status0}`, "error");
    await snap(page, "A1-blocked");
    return false;
  }
  await snap(page, "A1-naver-home");

  // ── STEP 2: 검색창 활성화 ──
  // m.naver.com의 검색바는 페이크 (클릭 시 검색 전용 화면으로 전환)
  log(`[A-2] 검색창 활성화 (페이크 바 → 실제 input 전환)`);

  // 페이크 검색바 영역 클릭 (검색 화면으로 전환)
  const fakeBarSelectors = [
    '.search_area_inner',         // 검색 영역 내부
    '.search_area',               // 검색 영역
    '#MM_SEARCH_FAKE',            // 페이크 검색
    '[class*="Nsearch"] [class*="search"]',
    'div[class*="search_input"]', // 검색 입력 영역
    'a[href*="search"]',          // 검색 링크
  ];

  let fakeBarClicked = false;
  for (const sel of fakeBarSelectors) {
    const el = await page.$(sel);
    if (el) {
      const box = await el.evaluate((e: Element) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      });
      if (box) {
        log(`  페이크 검색바 터치: ${sel} (${box.x.toFixed(0)}, ${box.y.toFixed(0)})`);
        await page.touchscreen.tap(box.x, box.y);
        fakeBarClicked = true;
        break;
      }
    }
  }

  if (!fakeBarClicked) {
    // 폴백: 페이지 상단 중앙 영역 터치 (검색바 위치 추정)
    log("  페이크 검색바 셀렉터 실패, 좌표 추정 터치", "warn");
    const vp = page.viewport();
    const centerX = vp ? vp.width / 2 : 200;
    await page.touchscreen.tap(centerX, 180); // 검색바 높이 추정
  }

  await sleep(rand(800, 1500));

  // 검색 화면 전환 후 실제 input 탐색
  const realInputSelectors = [
    "#query",
    'input#query',
    'input[name="query"]',
    'input[type="search"]',
    'input[placeholder*="검색"]',
    'input.search_input',
    'textarea[name="query"]',
  ];

  let searchInput: any = null;
  for (const sel of realInputSelectors) {
    searchInput = await page.$(sel);
    if (searchInput) {
      // ★ CAPTCHA input이 아닌지 확인
      const isCaptchaInput = await searchInput.evaluate((el: HTMLElement) => {
        const text = document.body?.innerText || "";
        return text.includes("보안 확인") || text.includes("자동입력방지") || text.includes("영수증");
      });
      if (isCaptchaInput) {
        log(`  ★ CAPTCHA 페이지 input 감지 — 검색창 아님!`, "warn");
        searchInput = null;
        return false;
      }
      log(`  실제 검색 input 발견: ${sel}`);
      break;
    }
  }

  if (!searchInput) {
    log("  검색 input 못 찾음", "error");
    // 디버깅: 현재 페이지 상태
    const debugInfo = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      inputs: Array.from(document.querySelectorAll("input")).map((i) => ({
        type: i.type, id: i.id, name: i.name, placeholder: i.placeholder,
      })),
    }));
    log(`  DEBUG: ${JSON.stringify(debugInfo)}`, "warn");
    await snap(page, "A2-no-input");
    return false;
  }

  // ── STEP 2b: 키워드 입력 ──
  log(`[A-2] "${KEYWORD}" 입력`);
  await searchInput.click();
  await sleep(rand(200, 400));

  // 클리어
  const tripleClick = await searchInput.evaluate((el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(tripleClick.x, tripleClick.y, { clickCount: 3 });
  await sleep(100);
  await page.keyboard.press("Backspace");
  await sleep(200);

  await humanType(page, KEYWORD);
  log(`  "${KEYWORD}" 입력 완료`);
  await sleep(rand(600, 1000));
  await snap(page, "A2-keyword");

  // ── STEP 3: 검색 실행 ──
  log("[A-3] Enter → 검색 실행");
  const navP = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
  await page.keyboard.press("Enter");
  await navP;
  await sleep(rand(2000, 3000));

  const searchUrl = page.url();
  log(`  검색결과 URL: ${searchUrl}`);
  await snap(page, "A3-search-result");

  // ★ 상태 체크
  const status1 = await checkPageStatus(page);
  if (status1 !== "ok") {
    log(`  검색결과 페이지 상태: ${status1}`, "error");
    await snap(page, "A3-blocked");
    return false;
  }

  // ── STEP 4: 쇼핑탭 클릭 ──
  log("[A-4] 쇼핑탭 찾기");

  const tabSelectors = [
    'a[data-tab="shp"]',
    'a[href*="msearch.shopping.naver"]',
    '#_search_tab a[href*="shopping"]',
    'a.tab[href*="shopping"]',
    'a[class*="tab"][href*="shopping"]',
  ];

  let shoppingTab: any = null;
  for (const sel of tabSelectors) {
    shoppingTab = await page.$(sel);
    if (shoppingTab) {
      log(`  쇼핑탭 발견: ${sel}`);
      break;
    }
  }

  // 폴백: 모든 <a> 에서 "쇼핑" 텍스트 + shopping href
  if (!shoppingTab) {
    log("  셀렉터 매칭 실패, 텍스트 폴백 탐색...", "warn");
    const links = await page.$$("a");
    for (const link of links) {
      const info = await link.evaluate((el: Element) => ({
        text: el.textContent?.trim() || "",
        href: el.getAttribute("href") || "",
      }));
      if ((info.text === "쇼핑" || info.text.startsWith("쇼핑")) && info.href.includes("shopping")) {
        shoppingTab = link;
        log(`  쇼핑탭 텍스트 폴백 발견: "${info.text}"`);
        break;
      }
    }
  }

  if (!shoppingTab) {
    // 디버깅: 탭 영역 출력
    const debugTabs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a"))
        .filter((a) => {
          const p = a.closest('[class*="tab"], [id*="tab"], [role="tablist"]');
          return !!p;
        })
        .slice(0, 15)
        .map((a) => ({
          text: a.textContent?.trim().substring(0, 20),
          href: (a.getAttribute("href") || "").substring(0, 80),
        }));
    });
    log(`  DEBUG 탭 목록: ${JSON.stringify(debugTabs)}`, "warn");
    log("  쇼핑탭 못 찾음", "error");
    return false;
  }

  // target="_blank" 제거 → 같은 탭에서 이동
  await shoppingTab.evaluate((el: HTMLElement) => el.removeAttribute("target"));

  // 터치 탭
  const tabBox = await shoppingTab.evaluate((el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });

  log("[A-4] 쇼핑탭 클릭");
  const shopNavP = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);

  if (tabBox) {
    await page.touchscreen.tap(tabBox.x, tabBox.y);
  } else {
    await shoppingTab.click();
  }

  await shopNavP;
  await sleep(rand(2000, 3500));

  const shopUrl = page.url();
  log(`  쇼핑 URL: ${shopUrl}`);
  await snap(page, "A4-shopping-tab");

  if (!shopUrl.includes("shopping")) {
    log(`  쇼핑 페이지 진입 실패`, "error");
    return false;
  }

  // ★ 상태 체크
  const status2 = await checkPageStatus(page);
  if (status2 !== "ok") {
    log(`  쇼핑 페이지 상태: ${status2}`, "error");
    await snap(page, "A4-blocked");
    return false;
  }

  log("[A-4] ✅ 쇼핑 검색결과 진입 성공");

  // ── STEP 5: 상품 로드 (스크롤) ──
  return await clickNthProduct(page, cdp);
}

// ================================================================
//  접근 B: m.naver.com → 스토어 → 쇼핑홈 검색 → 2번째 상품
// ================================================================
async function approachB(page: Page, cdp: any): Promise<boolean> {
  log("━━━ 접근 B: 스토어 → 쇼핑홈 검색 ━━━");

  // ── STEP 1: m.naver.com 접속 ──
  log("[B-1] m.naver.com 접속");
  await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(rand(1500, 2500));

  // ── STEP 2: 스토어 링크 클릭 ──
  log("[B-2] 스토어 링크 찾기");

  const storeSelectors = [
    'a[data-clk="shortsho"]',
    'a[href*="shopping.naver.com/ns/home"]',
    'a.chm_service[href*="shopping"]',
  ];

  let storeLink: any = null;
  for (const sel of storeSelectors) {
    storeLink = await page.$(sel);
    if (storeLink) {
      log(`  스토어 링크 발견: ${sel}`);
      break;
    }
  }

  // 폴백: 텍스트 "스토어"
  if (!storeLink) {
    const links = await page.$$("a");
    for (const link of links) {
      const text = await link.evaluate((el: Element) => el.textContent?.trim() || "");
      if (text === "스토어" || text === "쇼핑") {
        storeLink = link;
        log(`  스토어 텍스트 폴백: "${text}"`);
        break;
      }
    }
  }

  if (!storeLink) {
    log("  스토어 링크 못 찾음", "error");
    return false;
  }

  await storeLink.evaluate((el: HTMLElement) => el.removeAttribute("target"));

  const storeBox = await storeLink.evaluate((el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });

  const storeNavP = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);

  if (storeBox) {
    await page.touchscreen.tap(storeBox.x, storeBox.y);
  } else {
    await storeLink.evaluate((el: HTMLElement) => el.click());
  }

  await storeNavP;
  await sleep(rand(2000, 3000));

  const storeUrl = page.url();
  log(`  스토어 URL: ${storeUrl}`);
  await snap(page, "B2-store-home");

  // ★ 즉시 CAPTCHA/차단 체크 (스토어 진입 직후)
  const storeStatus = await checkPageStatus(page);
  if (storeStatus !== "ok") {
    log(`  ★ 스토어 진입 직후 ${storeStatus} 감지! 쇼핑홈이 아닌 ${storeStatus} 페이지`, "error");
    await snap(page, "B2-captcha-detected");
    return false;
  }

  if (!storeUrl.includes("shopping.naver.com")) {
    log("  쇼핑홈 진입 실패", "error");
    return false;
  }

  // ── STEP 3: 쇼핑홈 검색창 ──
  log(`[B-3] 쇼핑홈 검색창에 "${KEYWORD}" 입력`);

  const shopSearchSelectors = [
    'input[placeholder*="검색"]',
    'input[type="search"]',
    "#gnb-gnb input",
    'div[class*="search"] input',
    'input[name="query"]',
  ];

  let shopSearch: any = null;
  for (const sel of shopSearchSelectors) {
    const candidate = await page.$(sel);
    if (!candidate) continue;

    // ★ CAPTCHA input이 아닌지 확인
    const isSafe = await candidate.evaluate((el: HTMLElement) => {
      const bodyText = document.body?.innerText || "";
      // CAPTCHA 관련 텍스트가 있으면 이 input은 검색창이 아님
      if (bodyText.includes("보안 확인") || bodyText.includes("영수증") || bodyText.includes("자동입력방지")) {
        return false;
      }
      // placeholder에 "정답" 같은 CAPTCHA 관련 텍스트
      const ph = (el as HTMLInputElement).placeholder || "";
      if (ph.includes("정답") || ph.includes("답변")) {
        return false;
      }
      return true;
    });

    if (!isSafe) {
      log(`  ★ ${sel} → CAPTCHA input! 건너뜀`, "warn");
      continue;
    }

    shopSearch = candidate;
    log(`  검색창 발견: ${sel}`);
    break;
  }

  // 폴백: input[type="text"] 중 안전한 것만
  if (!shopSearch) {
    const allInputs = await page.$$('input[type="text"]');
    for (const inp of allInputs) {
      const isSafe = await inp.evaluate((el: HTMLInputElement) => {
        const bodyText = document.body?.innerText || "";
        if (bodyText.includes("보안 확인") || bodyText.includes("영수증")) return false;
        if (el.placeholder?.includes("정답")) return false;
        return true;
      });
      if (isSafe) {
        shopSearch = inp;
        log(`  검색창 발견: input[type="text"] (폴백)`);
        break;
      }
    }
  }

  // 폴백: 검색 아이콘/영역 클릭 후 재탐색
  if (!shopSearch) {
    const searchArea = await page.$('[class*="search"], [class*="Search"], [data-nclick*="search"]');
    if (searchArea) {
      await searchArea.click();
      await sleep(800);
      for (const sel of shopSearchSelectors) {
        shopSearch = await page.$(sel);
        if (shopSearch) break;
      }
    }
  }

  if (!shopSearch) {
    log("  쇼핑홈 검색창 못 찾음", "error");
    const inputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("input")).map((i) => ({
        type: i.type,
        placeholder: i.placeholder,
        id: i.id,
        cls: i.className.substring(0, 40),
      }))
    );
    log(`  DEBUG inputs: ${JSON.stringify(inputs)}`, "warn");
    return false;
  }

  await shopSearch.click();
  await sleep(rand(300, 600));

  // 클리어
  const tripleClick2 = await shopSearch.evaluate((el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(tripleClick2.x, tripleClick2.y, { clickCount: 3 });
  await sleep(100);
  await page.keyboard.press("Backspace");
  await sleep(200);

  await humanType(page, KEYWORD);
  await sleep(rand(600, 1000));
  await snap(page, "B3-keyword");

  // 검색 실행
  log("[B-3] Enter → 검색");
  const searchNavP = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
  await page.keyboard.press("Enter");
  await searchNavP;
  await sleep(rand(2000, 3500));

  const shopSearchUrl = page.url();
  log(`  검색결과 URL: ${shopSearchUrl}`);
  await snap(page, "B4-shop-search");

  const status = await checkPageStatus(page);
  if (status !== "ok") {
    log(`  쇼핑 검색결과 상태: ${status}`, "error");
    return false;
  }

  // ── STEP 4: 상품 클릭 ──
  return await clickNthProduct(page, cdp);
}

// ================================================================
//  공통: N번째 상품 찾기 + 클릭 + 상세페이지 진입
// ================================================================
async function clickNthProduct(page: Page, cdp: any): Promise<boolean> {
  // ── 상품 로드 (터치 스크롤) ──
  log("[공통] 상품 목록 로드 (스크롤)");
  await sleep(1000);
  await touchScroll(cdp, page, 2500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(800);

  // ── N번째 상품 탐색 ──
  log(`[공통] ${TARGET_PRODUCT_INDEX}번째 상품 찾기 (광고 제외)`);

  const products = await page.evaluate((targetIdx: number) => {
    // 셀렉터 1순위: data-shp-contents-id
    const anchors = document.querySelectorAll("a[data-shp-contents-id]");
    const list: { mid: string; href: string; text: string; idx: number }[] = [];
    let seq = 0;

    for (const a of anchors) {
      const inv = a.getAttribute("data-shp-inventory") || "";
      if (/lst\*(A|P|D)/.test(inv)) continue; // 광고 제외
      seq++;
      list.push({
        mid: a.getAttribute("data-shp-contents-id") || "",
        href: a.getAttribute("href") || "",
        text: (a.textContent || "").replace(/\s+/g, " ").trim().substring(0, 60),
        idx: seq,
      });
    }

    return {
      total: list.length,
      top5: list.slice(0, 5),
      target: list.find((p) => p.idx === targetIdx) || null,
    };
  }, TARGET_PRODUCT_INDEX);

  log(`  총 상품: ${products.total}개 (광고 제외)`);
  for (const p of products.top5) {
    const mark = p.idx === TARGET_PRODUCT_INDEX ? " ◀ TARGET" : "";
    log(`  #${p.idx}: [MID ${p.mid}] ${p.text.substring(0, 40)}${mark}`);
  }

  if (!products.target) {
    log(`  ${TARGET_PRODUCT_INDEX}번째 상품 없음 (총 ${products.total}개)`, "error");
    return false;
  }

  const targetMid = products.target.mid;
  log(`  타겟: MID=${targetMid}`);

  // ── 상품 클릭 ──
  const link = await page.$(`a[data-shp-contents-id="${targetMid}"]`);
  if (!link) {
    log("  상품 링크 DOM에서 못 찾음", "error");
    return false;
  }

  // 뷰포트 중앙으로 스크롤
  await link.evaluate((el: Element) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await sleep(rand(500, 1000));
  await snap(page, "05-before-click");

  // touchscreen.tap
  const box = await link.evaluate((el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });

  log("[공통] 상품 클릭");
  const prodNavP = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);

  if (box) {
    log(`  터치 좌표: (${box.x.toFixed(0)}, ${box.y.toFixed(0)})`);
    await page.touchscreen.tap(box.x, box.y);
  } else {
    await link.click();
  }

  await prodNavP;
  await sleep(rand(2000, 3500));

  // ── 상세페이지 진입 확인 ──
  const finalUrl = page.url();
  log(`  최종 URL: ${finalUrl}`);
  await snap(page, "06-product-page");

  const status = await checkPageStatus(page);
  if (status === "blocked") {
    log("  ❌ 접근 차단 감지", "error");
    return false;
  }
  if (status === "captcha") {
    log("  ⚠️ CAPTCHA 감지", "warn");
    return false;
  }

  const isProduct =
    finalUrl.includes("smartstore.naver.com") ||
    finalUrl.includes("brand.naver.com") ||
    finalUrl.includes("shopping.naver.com/window-products/") ||
    finalUrl.includes("/products/") ||
    finalUrl.includes("shopping.naver.com/product/");

  if (isProduct) {
    log("  ✅ ====== 상품 상세페이지 진입 성공! ======");

    // 체류
    const dwell = rand(3000, 6000);
    log(`  체류 ${(dwell / 1000).toFixed(1)}초...`);
    await sleep(dwell);

    // 자연스러운 스크롤 (체류 행동)
    await touchScroll(cdp, page, 1500);
    await sleep(rand(1000, 2000));
    await snap(page, "07-dwell");
    return true;
  }

  log(`  상품 페이지 여부 불확실: ${finalUrl}`, "warn");
  const bodySnippet = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || "");
  log(`  페이지 텍스트: ${bodySnippet}`, "warn");
  return false;
}

// ================================================================
//  메인
// ================================================================
async function main(): Promise<void> {
  log("══════════════════════════════════════════════════");
  log(`  쇼핑탭 독립 테스트  |  키워드: "${KEYWORD}"  |  타겟: ${TARGET_PRODUCT_INDEX}번째 상품`);
  log("══════════════════════════════════════════════════");

  let browser: Browser | null = null;

  try {
    // ── 브라우저 시작 ──
    log("브라우저 시작...");
    const resp = await connect({
      headless: HEADLESS,
      turnstile: true,
      args: [
        "--window-size=480,960",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        `--user-agent=${MOBILE_UA}`,
      ],
    });

    browser = resp.browser as Browser;
    const page = resp.page as Page;

    // 모바일 뷰포트
    await page.setViewport(MOBILE_VIEWPORT);
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    // 스텔스 스크립트
    await injectMobileStealth(page);

    // CDP 세션 + Sec-Fetch 인터셉트
    const cdp = await (page as any).createCDPSession();
    await setupCDPIntercept(page, cdp);

    // 터치 에뮬레이션
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });

    // ── 접근 A 시도 ──
    let success = false;
    try {
      success = await approachA(page, cdp);
    } catch (e: any) {
      log(`접근 A 예외: ${e.message}`, "error");
    }

    // ── A 실패 시 접근 B ──
    if (!success) {
      log("접근 A 실패 → 접근 B로 폴백", "warn");
      try {
        success = await approachB(page, cdp);
      } catch (e: any) {
        log(`접근 B 예외: ${e.message}`, "error");
      }
    }

    // ── 결과 요약 ──
    log("══════════════════════════════════════════════════");
    log(`  결과: ${success ? "✅ 성공" : "❌ 실패"}`);
    log(`  키워드: ${KEYWORD}`);
    log(`  타겟: ${TARGET_PRODUCT_INDEX}번째 상품`);
    log(`  최종 URL: ${page.url()}`);
    log("══════════════════════════════════════════════════");

    if (!CLOSE_BROWSER_ON_END) {
      log("브라우저 유지 중 (CLOSE_BROWSER_ON_END=false). Ctrl+C로 종료.");
      await new Promise(() => {}); // 무한 대기
    }
  } catch (e: any) {
    log(`FATAL: ${e.message}`, "error");
    log(`Stack: ${(e.stack || "").substring(0, 400)}`, "error");
  } finally {
    if (browser && CLOSE_BROWSER_ON_END) {
      await sleep(2000);
      await browser.close().catch(() => {});
    }
    log("테스트 종료");
  }
}

// EPERM 에러 suppress (Windows temp 폴더 정리 시 발생)
process.on("uncaughtException", (err) => {
  const msg = err.message || "";
  if (
    (msg.includes("EPERM") || msg.includes("ENOENT")) &&
    (msg.includes("temp") || msg.includes("lighthouse") || msg.includes("puppeteer"))
  ) {
    return; // 무시
  }
  console.error("[UNCAUGHT]", err);
  process.exit(1);
});

main().catch(console.error);
