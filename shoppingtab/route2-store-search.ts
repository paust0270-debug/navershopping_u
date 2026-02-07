/**
 * route2-store-search.ts
 *
 * 경로 2: m.naver.com → 스토어 → 쇼핑홈 → 검색 → N번째 상품 상세페이지
 *
 * 실행: npx tsx shoppingtab/route2-store-search.ts
 */

import { connect } from "puppeteer-real-browser";
import type { Page, Browser } from "puppeteer-core";
import * as fs from "fs";

// ============ 설정 ============
const KEYWORD = "장난감";
const TARGET_PRODUCT_INDEX = 2;
const SCREENSHOT_DIR = "./screenshots/route2";
const MAX_CAPTCHA_ATTEMPTS = 5;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const MOBILE_VIEWPORT = { width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };

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

    // 영수증 이미지 추출 (가장 큰 img)
    let base64 = "";
    const imgEl = await page.evaluateHandle(() => {
      const imgs = Array.from(document.querySelectorAll("img"));
      let best: HTMLImageElement | null = null; let max = 0;
      for (const img of imgs) { const r = img.getBoundingClientRect(); const a = r.width * r.height; if (a > max && r.width > 100) { max = a; best = img; } }
      return best;
    });
    try {
      const el = imgEl.asElement ? imgEl.asElement() : imgEl;
      if (el) { const buf = await (el as any).screenshot({ encoding: "binary" }) as Buffer; base64 = buf.toString("base64"); fs.writeFileSync(`${SCREENSHOT_DIR}/receipt-${i}.png`, buf); }
    } catch { const buf = await page.screenshot({ encoding: "binary" }) as Buffer; base64 = buf.toString("base64"); }

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

// ============ CDP 인터셉트 ============
function calcSite(req: string, page: string): string {
  if (!page || page === "about:blank") return "none";
  try {
    const rh = new URL(req).hostname, ph = new URL(page).hostname;
    if (rh === ph) return "same-origin";
    if (rh.split(".").slice(-2).join(".") === ph.split(".").slice(-2).join(".")) return "same-site";
    return "cross-site";
  } catch { return "cross-site"; }
}
async function setupCDP(page: Page, cdp: any) {
  await cdp.send("Fetch.enable", { patterns: [{ requestStage: "Request", resourceType: "Document" }] });
  let cur = page.url();
  page.on("framenavigated", (f: any) => { try { if (f === page.mainFrame()) cur = f.url(); } catch {} });
  cdp.on("Fetch.requestPaused", async (ev: any) => {
    try {
      const h = Object.entries(ev.request.headers).filter(([k]) => !k.toLowerCase().startsWith("sec-fetch")).map(([n, v]) => ({ name: n, value: String(v) }));
      const s = calcSite(ev.request.url, cur);
      await cdp.send("Fetch.continueRequest", { requestId: ev.requestId, headers: [...h,
        { name: "Sec-Fetch-Dest", value: "document" }, { name: "Sec-Fetch-Mode", value: "navigate" },
        { name: "Sec-Fetch-Site", value: s }, { name: "Sec-Fetch-User", value: "?1" },
        { name: "Upgrade-Insecure-Requests", value: "1" },
      ]});
    } catch { try { await cdp.send("Fetch.continueRequest", { requestId: ev.requestId }); } catch {} }
  });
}

// ============ 스크롤 ============
async function touchScroll(cdp: any, page: Page, dist: number) {
  const vp = page.viewport(); const x = vp ? vp.width / 2 : 200; const y = vp ? vp.height / 2 : 400;
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
//  메인: 경로 2 — 스토어 → 쇼핑홈 → 검색 → 상품
// ================================================================
async function main() {
  log("══════════════════════════════════════════");
  log("  경로 2: m.naver.com → 스토어 → 쇼핑홈 → 검색 → 상품");
  log(`  키워드: "${KEYWORD}" | 타겟: ${TARGET_PRODUCT_INDEX}번째`);
  log("══════════════════════════════════════════");

  const resp = await connect({
    headless: false, turnstile: true,
    args: ["--window-size=480,960", "--disable-blink-features=AutomationControlled", `--user-agent=${MOBILE_UA}`],
  });
  const browser = resp.browser as Browser;
  const page = resp.page as Page;
  await page.setViewport(MOBILE_VIEWPORT);
  page.setDefaultTimeout(30000);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "platform", { get: () => "Linux armv8l" });
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
  });
  const cdp = await (page as any).createCDPSession();
  await setupCDP(page, cdp);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  try {
    // ── 1. m.naver.com ──
    log("[1] m.naver.com 접속");
    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(rand(1500, 2500));
    await snap(page, "01-home");

    // ── 2. 스토어 링크 → shopping.naver.com ──
    log("[2] 스토어 링크 클릭");
    const store = await page.$('a[data-clk="shortsho"]') || await page.$('a[href*="shopping.naver.com"]');
    if (!store) {
      // 폴백: 텍스트 "스토어"
      const links = await page.$$("a");
      let found: any = null;
      for (const l of links) {
        const txt = await l.evaluate((el: Element) => el.textContent?.trim() || "");
        if (txt === "스토어") { found = l; break; }
      }
      if (!found) throw new Error("스토어 링크 없음");
    }
    const storeEl = store || (await page.$$("a")).find(async l => (await l.evaluate((el: Element) => el.textContent?.trim())) === "스토어");
    if (!storeEl) throw new Error("스토어 링크 없음");

    await storeEl.evaluate((el: HTMLElement) => el.removeAttribute("target"));
    const sBox = await storeEl.evaluate((el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const nav1 = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
    await page.touchscreen.tap(sBox.x, sBox.y);
    await nav1;
    await sleep(rand(2000, 3000));
    log(`  URL: ${page.url()}`);
    await snap(page, "02-store");

    // ── 3. CAPTCHA 처리 ──
    const st1 = await pageStatus(page);
    if (st1 === "captcha") {
      log("[3] CAPTCHA 감지 → 자동 풀기");
      if (!await solveCaptcha(page)) throw new Error("CAPTCHA 실패");
    } else if (st1 === "blocked") {
      throw new Error("차단 페이지");
    }
    log(`  CAPTCHA 후 URL: ${page.url()}`);
    await snap(page, "03-after-captcha");

    // ── 4. 쇼핑홈 검색 ──
    log(`[4] 쇼핑홈에서 "${KEYWORD}" 검색`);
    const searchSelectors = [
      'input[placeholder*="검색"]',
      'input[type="search"]',
      '#gnb-gnb input',
      'input[name="query"]',
    ];

    let searchInput: any = null;
    for (const sel of searchSelectors) {
      const el = await page.$(sel);
      if (!el) continue;
      // CAPTCHA input 제외
      const safe = await el.evaluate((e: HTMLElement) => {
        const t = document.body?.innerText || "";
        if (t.includes("보안 확인") || t.includes("영수증")) return false;
        if ((e as HTMLInputElement).placeholder?.includes("정답")) return false;
        return true;
      });
      if (safe) { searchInput = el; log(`  검색창: ${sel}`); break; }
    }

    // 폴백: 안전한 input[type="text"]
    if (!searchInput) {
      const inputs = await page.$$('input[type="text"]');
      for (const inp of inputs) {
        const safe = await inp.evaluate((e: HTMLInputElement) => {
          const t = document.body?.innerText || "";
          return !t.includes("보안 확인") && !e.placeholder?.includes("정답");
        });
        if (safe) { searchInput = inp; log("  검색창: input[type=text] 폴백"); break; }
      }
    }

    if (!searchInput) {
      // 검색 영역 클릭 후 재탐색
      const area = await page.$('[class*="search"], [class*="Search"]');
      if (area) {
        await area.click(); await sleep(800);
        for (const sel of searchSelectors) { searchInput = await page.$(sel); if (searchInput) break; }
      }
    }

    if (!searchInput) throw new Error("쇼핑홈 검색창 없음");

    await searchInput.click();
    await sleep(rand(300, 600));
    // 클리어
    const pos = await searchInput.evaluate((el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(pos.x, pos.y, { clickCount: 3 });
    await sleep(100);
    await page.keyboard.press("Backspace");
    await sleep(200);

    await humanType(page, KEYWORD);
    log(`  "${KEYWORD}" 입력 완료`);
    await snap(page, "04-keyword");

    // 검색 실행
    log("[4] Enter → 검색");
    const nav2 = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
    await page.keyboard.press("Enter");
    await nav2;
    await sleep(rand(2000, 3000));
    log(`  검색 URL: ${page.url()}`);
    await snap(page, "05-search-result");

    // 검색 후 CAPTCHA 체크
    if ((await pageStatus(page)) === "captcha") {
      if (!await solveCaptcha(page)) throw new Error("검색 CAPTCHA 실패");
    }
    if ((await pageStatus(page)) === "blocked") throw new Error("검색 차단");

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
