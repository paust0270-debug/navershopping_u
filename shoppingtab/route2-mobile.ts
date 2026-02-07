/**
 * route2-mobile.ts
 *
 * 경로 2 (모바일): m.naver.com → 스토어 → 쇼핑홈 → 검색 → N번째 상품 상세페이지
 *
 * 모바일 UA + 뷰포트만 설정 (CDP/stealth 없음)
 * → CAPTCHA만 뜨고 (BLOCKED 아님) → Claude Vision 솔버로 해결
 *
 * 실행: npx tsx shoppingtab/route2-mobile.ts
 */

import { chromium, type Page, type BrowserContext } from "patchright";
import { detectRealChrome } from "../shared/mobile-stealth";
import * as fs from "fs";

// ============ 설정 ============
const KEYWORD = "장난감";
const TARGET_PRODUCT_INDEX = 2;
const SCREENSHOT_DIR = "./screenshots/route2-mobile";
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
      const t = document.body?.innerText || "";
      // 1) "무엇입니까?" 형식
      const m1 = t.match(/.+무엇입니까\??/);
      if (m1) return m1[0].trim();
      // 2) "빈 칸을 채워주세요" + [?] 패턴
      const m2 = t.match(/영수증의\s+.+?\s+\[?\?\]?\s*입니다/);
      if (m2) return m2[0].trim();
      // 3) 특정 패턴들
      const patterns = [
        /가게\s*위치는\s*.+?\s*\[?\?\]?\s*입니다/,
        /전화번호는?\s*.+?\s*\[?\?\]?\s*입니다/,
        /상호명은?\s*.+?\s*\[?\?\]?\s*입니다/,
        /.+번째\s*숫자는\s*무엇입니까/,
        /.+번째\s*글자는\s*무엇입니까/,
      ];
      for (const p of patterns) { const m = t.match(p); if (m) return m[0].trim(); }
      // 4) 빈 칸 채우기
      const lines = t.split("\n").map(l => l.trim());
      return lines.find(l => l.includes("무엇입니까") || l.includes("채워주세요") || l.includes("[?]")) || "";
    });
    log(`질문: ${question}`);

    // 영수증 이미지 추출 (셀렉터 우선순위)
    let base64 = "";
    const imgSelectors = [
      "#rcpt_img",
      ".captcha_img",
      ".captcha_img_cover img",
      'img[alt="캡차이미지"]',
      'img[src*="captcha"]',
      'img[src*="receipt"]',
      ".captcha_image img",
      ".receipt_image img",
      '[class*="captcha"] img',
      '[class*="receipt"] img',
      ".security_check img",
      "#captcha_image",
    ];
    try {
      let imgEl = null;
      for (const sel of imgSelectors) {
        imgEl = await page.$(sel);
        if (imgEl) { log(`  이미지: ${sel}`); break; }
      }
      // 폴백: 가장 큰 img
      if (!imgEl) {
        const handle = await page.evaluateHandle(() => {
          const imgs = Array.from(document.querySelectorAll("img"));
          let best: HTMLImageElement | null = null; let max = 0;
          for (const img of imgs) { const a = img.width * img.height; if (a > max && img.width > 100) { max = a; best = img; } }
          return best;
        });
        imgEl = handle.asElement();
        if (imgEl) log("  이미지: 가장 큰 img (폴백)");
      }
      if (imgEl) {
        const buf = await imgEl.screenshot();
        base64 = buf.toString("base64");
        fs.writeFileSync(`${SCREENSHOT_DIR}/receipt-${i}.png`, buf);
      } else {
        const buf = await page.screenshot();
        base64 = buf.toString("base64");
        log("  이미지: 전체 페이지 (최종 폴백)");
      }
    } catch { const buf = await page.screenshot(); base64 = buf.toString("base64"); }

    let answer = "";
    try { answer = await analyzeReceipt(base64, question); } catch (e: any) { log(`AI 실패: ${e.message}`, "error"); continue; }
    if (!answer) continue;
    log(`답변: "${answer}"`);

    // 입력 (셀렉터 우선순위)
    const inputSelectors = [
      "input#rcpt_answer",
      'input[placeholder*="정답"]',
      'input[placeholder*="입력"]',
      'input[name*="answer"]',
      'input[id*="answer"]',
      ".captcha_input input",
      "#captcha_answer",
    ];
    let inp = null;
    for (const sel of inputSelectors) {
      inp = await page.$(sel);
      if (inp) { log(`  입력창: ${sel}`); break; }
    }
    if (!inp) { log("  입력창 없음", "error"); continue; }
    await inp.click(); await sleep(200);
    await inp.evaluate((el: HTMLInputElement) => { el.value = ""; el.focus(); });
    for (const c of answer) await page.keyboard.type(c, { delay: rand(80, 150) });
    await sleep(300);

    // 확인 버튼 (셀렉터 우선순위)
    let clicked = false;
    const btnSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      ".confirm_btn",
      ".submit_btn",
      'button[class*="confirm"]',
      'button[class*="submit"]',
    ];
    for (const sel of btnSelectors) {
      const btn = await page.$(sel);
      if (btn) { await btn.click(); clicked = true; log(`  버튼: ${sel}`); break; }
    }
    if (!clicked) {
      const btns = await page.$$("button");
      for (const btn of btns) {
        const txt = await btn.evaluate((el: HTMLElement) => el.textContent?.trim() || "");
        if (txt.includes("확인")) { await btn.click(); clicked = true; log("  버튼: 확인 텍스트"); break; }
      }
    }
    if (!clicked) { await page.keyboard.press("Enter"); log("  버튼: Enter 폴백"); }
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => {});
    await sleep(2000);
    await snap(page, `captcha-after-${i}`);
  }
  return (await pageStatus(page)) === "ok";
}

// ============ 스크롤 ============
async function smoothScroll(page: Page, dist: number) {
  let s = 0;
  while (s < dist) {
    const step = Math.floor(rand(150, 350));
    await page.mouse.wheel(0, step);
    s += step;
    await sleep(rand(100, 250));
  }
}

// ============ N번째 상품 클릭 ============
async function clickProduct(page: Page): Promise<boolean> {
  log(`[상품] ${TARGET_PRODUCT_INDEX}번째 상품 찾기`);
  await smoothScroll(page, 2500);
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
  if (box) await page.mouse.click(box.x, box.y); else await link.click();
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
  log("  경로 2 (모바일): m.naver.com → 스토어 → 쇼핑홈 → 검색 → 상품");
  log(`  키워드: "${KEYWORD}" | 타겟: ${TARGET_PRODUCT_INDEX}번째`);
  log("══════════════════════════════════════════");

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--window-size=480,960'],
  });

  // 실제 Chrome 버전 감지 → 모바일 UA 생성 (CDP/stealth 없이 UA+뷰포트만)
  const chrome = await detectRealChrome(browser);
  log(`Chrome: v${chrome.majorVersion} | Mobile UA: ${chrome.mobileUA.substring(0, 60)}...`);

  const context = await browser.newContext({
    userAgent: chrome.mobileUA,
    viewport: { width: 400, height: 700 },
    deviceScaleFactor: 3,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

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
    await page.mouse.click(sBox.x, sBox.y);
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
    const ok = await clickProduct(page);

    log("══════════════════════════════════════════");
    log(`결과: ${ok ? "✅ 성공" : "❌ 실패"}`);
    log(`URL: ${page.url()}`);
    log("══════════════════════════════════════════");

    if (ok) { await sleep(rand(3000, 5000)); await smoothScroll(page, 1500); await snap(page, "final"); }

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
