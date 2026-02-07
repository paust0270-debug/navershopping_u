/**
 * route1-search-tab.ts
 *
 * 경로 1: m.naver.com → 검색 → 쇼핑탭 클릭 → N번째 상품 상세페이지
 *
 * 실행: npx tsx shoppingtab/route1-search-tab.ts
 */

import { chromium, type Page, type BrowserContext } from "patchright";
import { applyMobileStealth, MOBILE_CONTEXT_OPTIONS } from "../shared/mobile-stealth";
import * as fs from "fs";

// ============ 설정 ============
const KEYWORD = "장난감";
const TARGET_PRODUCT_INDEX = 2;
const SCREENSHOT_DIR = "./screenshots/route1";
const MAX_CAPTCHA_ATTEMPTS = 5;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

// ============ 공통 유틸 ============
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
function log(msg: string, level = "info") {
  const t = new Date().toISOString().substring(11, 19);
  console.log(`[${t}] [${level.toUpperCase()}] ${msg}`);
}
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
async function snap(page: Page, name: string) {
  try { await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` }); log(`📸 ${name}`); } catch {}
}
async function humanType(page: Page, text: string) {
  for (const c of text) { await page.keyboard.type(c, { delay: rand(60, 140) }); await sleep(rand(20, 70)); }
}

// ============ 페이지 상태 ============
async function pageStatus(page: Page): Promise<"ok" | "captcha" | "blocked"> {
  return page.evaluate(() => {
    const t = document.body?.innerText || "";
    if (t.includes("비정상적인 접근") || t.includes("일시적으로 제한") || (t.includes("접근이 제한") && t.includes("잠시 후"))) return "blocked";
    if (t.includes("보안 확인") || t.includes("자동입력방지") || t.includes("영수증")) return "captcha";
    return "ok";
  }) as Promise<"ok" | "captcha" | "blocked">;
}

// ============ Claude Vision CAPTCHA 솔버 ============
async function analyzeReceipt(imageBase64: string, question: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY 없음");
  log(`[AI] Claude Vision 호출...`);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 200,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: imageBase64 } },
        { type: "text", text: `영수증을 읽고 답하세요.\n질문: ${question}\n규칙:\n- 전화번호 하이픈 무시, 숫자만 카운트\n- "앞에서 N번째" = 왼쪽에서 N번째\n- "뒤에서 N번째" = 오른쪽에서 N번째\n- "가게 위치는 OO로 [?]" = 도로명 뒤 번지수\n- 숫자만 출력 (다른 텍스트 없이)\n답:` },
      ]}],
    }),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`API ${res.status}: ${e.substring(0, 100)}`); }
  const data = await res.json() as any;
  const answer = (data.content?.[0]?.text || "").trim();
  const num = answer.match(/\d+/);
  return num ? num[0] : answer;
}

async function solveCaptcha(page: Page): Promise<boolean> {
  for (let i = 1; i <= MAX_CAPTCHA_ATTEMPTS; i++) {
    const st = await pageStatus(page);
    if (st === "ok") return true;
    if (st === "blocked") { log("차단 페이지", "error"); return false; }

    log(`═══ CAPTCHA ${i}/${MAX_CAPTCHA_ATTEMPTS} ═══`);
    const question = await page.evaluate(() => {
      const lines = (document.body?.innerText || "").split("\n").map(l => l.trim());
      return lines.find(l => l.includes("무엇입니까") || l.includes("채워주세요")) || "";
    });
    log(`질문: ${question}`);

    // 영수증 이미지 추출
    let base64 = "";
    try {
      const bestImg = await page.evaluateHandle(() => {
        const imgs = Array.from(document.querySelectorAll("img"));
        let best: HTMLImageElement | null = null; let max = 0;
        for (const img of imgs) { const r = img.getBoundingClientRect(); const a = r.width * r.height; if (a > max && r.width > 100) { max = a; best = img; } }
        return best;
      });
      const el = bestImg.asElement();
      if (el) { const buf = await el.screenshot(); base64 = buf.toString("base64"); fs.writeFileSync(`${SCREENSHOT_DIR}/receipt-${i}.png`, buf); }
      else { const buf = await page.screenshot(); base64 = buf.toString("base64"); }
    } catch { const buf = await page.screenshot(); base64 = buf.toString("base64"); }

    let answer = "";
    try { answer = await analyzeReceipt(base64, question); } catch (e: any) { log(`AI 실패: ${e.message}`, "error"); continue; }
    if (!answer) continue;
    log(`답변: "${answer}"`);

    // 입력
    const inp = await page.$('input#rcpt_answer') || await page.$('input[placeholder*="정답"]');
    if (!inp) continue;
    await inp.click(); await sleep(200);
    await inp.evaluate((el: HTMLInputElement) => { el.value = ""; el.focus(); });
    for (const c of answer) await page.keyboard.type(c, { delay: rand(80, 150) });
    await sleep(300);

    // 확인
    const btns = await page.$$("button");
    for (const btn of btns) {
      const txt = await btn.evaluate((el: HTMLElement) => el.textContent?.trim() || "");
      if (txt.includes("확인")) { await btn.click(); break; }
    }
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => {});
    await sleep(2000);
    await snap(page, `captcha-after-${i}`);
  }
  return (await pageStatus(page)) === "ok";
}

// ============ 스크롤 ============
async function touchScroll(cdp: any, page: Page, dist: number) {
  const vp = page.viewportSize(); const x = vp ? vp.width / 2 : 200; const y = vp ? vp.height / 2 : 400;
  let s = 0;
  while (s < dist) {
    const step = rand(200, 400);
    try { await cdp.send("Input.synthesizeScrollGesture", { x, y, yDistance: -Math.floor(step), speed: Math.floor(rand(800, 1200)), gestureSourceType: "touch", repeatCount: 1, repeatDelayMs: 0, xDistance: 0 }); }
    catch { await page.evaluate((d: number) => window.scrollBy(0, d), step).catch(() => {}); }
    s += step; await sleep(rand(100, 250));
  }
}

// ============ N번째 상품 클릭 ============
async function clickProduct(page: Page, cdp: any): Promise<boolean> {
  log(`[상품] ${TARGET_PRODUCT_INDEX}번째 상품 찾기`);
  await touchScroll(cdp, page, 2500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(800);

  const products = await page.evaluate((idx: number) => {
    const list: { mid: string; text: string; i: number }[] = []; let seq = 0;
    for (const a of document.querySelectorAll("a[data-shp-contents-id]")) {
      if (/lst\*(A|P|D)/.test(a.getAttribute("data-shp-inventory") || "")) continue;
      seq++;
      list.push({ mid: a.getAttribute("data-shp-contents-id") || "", text: (a.textContent || "").replace(/\s+/g, " ").trim().substring(0, 50), i: seq });
    }
    return { total: list.length, top5: list.slice(0, 5), target: list.find(p => p.i === idx) };
  }, TARGET_PRODUCT_INDEX);

  log(`  총 ${products.total}개`);
  products.top5.forEach((p: any) => log(`  #${p.i}: [${p.mid}] ${p.text}${p.i === TARGET_PRODUCT_INDEX ? " ◀" : ""}`));
  if (!products.target) { log("상품 없음", "error"); return false; }

  const link = await page.$(`a[data-shp-contents-id="${products.target.mid}"]`);
  if (!link) return false;
  await link.evaluate((el: Element) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await sleep(rand(500, 1000));
  await snap(page, "before-click");

  const box = await link.evaluate((el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; });
  const nav = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
  if (box) await page.touchscreen.tap(box.x, box.y); else await link.click();
  await nav;
  await sleep(rand(2000, 3500));

  if ((await pageStatus(page)) === "captcha") await solveCaptcha(page);

  const url = page.url();
  const ok = url.includes("smartstore") || url.includes("brand.naver") || url.includes("window-products") || url.includes("/products/");
  await snap(page, "product-detail");
  return ok;
}

// ================================================================
//  메인: 경로 1 — 검색 → 쇼핑탭 → 상품
// ================================================================
async function main() {
  log("══════════════════════════════════════════");
  log("  경로 1: m.naver.com → 검색 → 쇼핑탭 → 상품");
  log(`  키워드: "${KEYWORD}" | 타겟: ${TARGET_PRODUCT_INDEX}번째`);
  log("══════════════════════════════════════════");

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--window-size=480,960'],
  });
  // extraHTTPHeaders의 sec-ch-ua 제거 — Chrome이 자체 값 사용하도록
  // (헤더에 "Not-A.Brand";v="99" vs JS에서 "Not(A:Brand";v="8" 불일치 방지)
  const { extraHTTPHeaders, ...contextOpts } = MOBILE_CONTEXT_OPTIONS;
  const context = await browser.newContext(contextOpts);
  await applyMobileStealth(context);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const cdp = await context.newCDPSession(page);

  // CDP로 navigator.platform + userAgentData(Client Hints) 전부 설정
  // addInitScript의 defineProperty는 C++ 레벨에서 무시되므로 CDP 필수
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
  // CDP로 maxTouchPoints 강제 설정 (context의 hasTouch:true는 1만 설정)
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 5,
  });

  try {
    // ── 1. m.naver.com ──
    log("[1] m.naver.com 접속");
    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(rand(1500, 2500));
    if ((await pageStatus(page)) !== "ok") throw new Error("m.naver.com 차단");
    await snap(page, "01-home");

    // ── 2. 검색창 활성화 (페이크 바 → 실제 input) ──
    log("[2] 검색창 활성화");
    const fakeBar = await page.$("#MM_SEARCH_FAKE") || await page.$(".search_area");
    if (fakeBar) {
      const box = await fakeBar.evaluate((el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.touchscreen.tap(box.x, box.y);
      await sleep(rand(800, 1200));
    }
    const input = await page.$("#query") || await page.$('input[name="query"]');
    if (!input) throw new Error("검색 input 없음");

    // CAPTCHA input이 아닌지 확인
    const safe = await input.evaluate(() => !(document.body?.innerText || "").includes("보안 확인"));
    if (!safe) throw new Error("CAPTCHA 페이지에서 검색 불가");

    await input.click(); await sleep(200);
    await humanType(page, KEYWORD);
    log(`  "${KEYWORD}" 입력 완료`);
    await snap(page, "02-keyword");

    // ── 3. 검색 실행 ──
    log("[3] 검색 실행");
    const nav1 = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
    await page.keyboard.press("Enter");
    await nav1;
    await sleep(rand(2000, 3000));
    log(`  URL: ${page.url()}`);
    await snap(page, "03-search-result");

    if ((await pageStatus(page)) === "captcha") { if (!await solveCaptcha(page)) throw new Error("검색 CAPTCHA 실패"); }
    if ((await pageStatus(page)) === "blocked") throw new Error("검색결과 차단");

    // ── 4. 쇼핑탭 클릭 ──
    log("[4] 쇼핑탭 찾기");
    let tab = await page.$('a[href*="msearch.shopping.naver"]');
    if (!tab) {
      const links = await page.$$("a");
      for (const l of links) {
        const info = await l.evaluate((el: Element) => ({ text: el.textContent?.trim() || "", href: el.getAttribute("href") || "" }));
        if (info.text.startsWith("쇼핑") && info.href.includes("shopping")) { tab = l; break; }
      }
    }
    if (!tab) throw new Error("쇼핑탭 없음");

    await tab.evaluate((el: HTMLElement) => el.removeAttribute("target"));
    const tabBox = await tab.evaluate((el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; });

    log("[4] 쇼핑탭 클릭");
    const nav2 = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
    if (tabBox) await page.touchscreen.tap(tabBox.x, tabBox.y); else await tab.click();
    await nav2;
    await sleep(rand(2000, 3500));
    log(`  쇼핑 URL: ${page.url()}`);
    await snap(page, "04-shopping");

    const st = await pageStatus(page);
    if (st === "captcha") { if (!await solveCaptcha(page)) throw new Error("쇼핑 CAPTCHA 실패"); }
    if (st === "blocked") throw new Error("쇼핑 차단 (msearch.shopping.naver.com은 하드블록 가능)");

    // ── 5. 상품 클릭 ──
    const ok = await clickProduct(page, cdp);

    log("══════════════════════════════════════════");
    log(`결과: ${ok ? "✅ 성공" : "❌ 실패"}`);
    log(`URL: ${page.url()}`);
    log("══════════════════════════════════════════");

    if (ok) { await sleep(rand(3000, 5000)); await touchScroll(cdp, page, 1500); await snap(page, "final"); }

  } catch (e: any) {
    log(`FATAL: ${e.message}`, "error");
    await snap(page, "99-error");
  }

  log("브라우저 유지 중. Ctrl+C 종료.");
  await new Promise(() => {});
}

process.on("uncaughtException", (err) => {
  if ((err.message || "").includes("EPERM") && (err.message || "").includes("temp")) return;
  console.error("[UNCAUGHT]", err); process.exit(1);
});
main().catch(console.error);
