/**
 * captcha-auto.ts
 *
 * 네이버 쇼핑 CAPTCHA 자동 풀기 + 쇼핑 상세페이지 진입
 * 영수증 이미지 → Claude Vision API → 자동 답변 → 제출
 *
 * 실행: npx tsx captcha-auto.ts
 */

import { connect } from "puppeteer-real-browser";
import type { Page, Browser } from "puppeteer-core";
import * as fs from "fs";

// ============ 설정 ============
const KEYWORD = "장난감";
const TARGET_PRODUCT_INDEX = 2;
const SCREENSHOT_DIR = "./screenshots";
const MAX_CAPTCHA_ATTEMPTS = 5;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "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";

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const MOBILE_VIEWPORT = { width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };

// ============ 유틸 ============
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
function log(msg: string, level = "info") {
  const t = new Date().toISOString().substring(11, 19);
  console.log(`[${t}] [${level.toUpperCase()}] ${msg}`);
}
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
async function snap(page: Page, name: string) {
  try { await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` }); } catch {}
}

// ============ Claude Vision API로 영수증 분석 ============
async function analyzeReceiptWithClaude(imageBase64: string, question: string): Promise<string> {
  log(`[AI] Claude Vision API 호출... 질문: "${question}"`);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: imageBase64 },
            },
            {
              type: "text",
              text: `이 영수증 이미지를 읽고 다음 질문에 답하세요.

질문: ${question}

규칙:
- 영수증에서 가게 전화번호, 주소, 상품명, 가격을 정확히 읽으세요
- 전화번호의 하이픈(-)은 무시하고 숫자만 카운트하세요
- "앞에서 N번째" = 왼쪽에서 N번째 숫자
- "뒤에서 N번째" = 오른쪽에서 N번째 숫자
- "가게 위치는 OO로 [?]" = 주소에서 도로명 뒤의 번지수
- 답변은 숫자만 출력하세요 (다른 텍스트 없이)

답:`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    log(`[AI] API 에러 ${response.status}: ${err}`, "error");
    throw new Error(`Claude API ${response.status}`);
  }

  const data = await response.json() as any;
  const answer = (data.content?.[0]?.text || "").trim();
  log(`[AI] Claude 답변: "${answer}"`);
  return answer;
}

// ============ CDP 인터셉트 ============
function calcSite(reqUrl: string, pageUrl: string): string {
  if (!pageUrl || pageUrl === "about:blank" || pageUrl.startsWith("chrome")) return "none";
  try {
    const r = new URL(reqUrl).hostname.split(".").slice(-2).join(".");
    const p = new URL(pageUrl).hostname.split(".").slice(-2).join(".");
    if (new URL(reqUrl).hostname === new URL(pageUrl).hostname) return "same-origin";
    if (r === p) return "same-site";
    return "cross-site";
  } catch { return "cross-site"; }
}

async function setupCDP(page: Page, cdp: any) {
  await cdp.send("Fetch.enable", {
    patterns: [{ requestStage: "Request", resourceType: "Document" }],
  });
  let curUrl = page.url();
  page.on("framenavigated", (f: any) => { try { if (f === page.mainFrame()) curUrl = f.url(); } catch {} });
  cdp.on("Fetch.requestPaused", async (ev: any) => {
    try {
      const cleaned = Object.entries(ev.request.headers)
        .filter(([k]) => !k.toLowerCase().startsWith("sec-fetch"))
        .map(([name, value]) => ({ name, value: String(value) }));
      const site = calcSite(ev.request.url, curUrl);
      await cdp.send("Fetch.continueRequest", {
        requestId: ev.requestId,
        headers: [
          ...cleaned,
          { name: "Sec-Fetch-Dest", value: "document" },
          { name: "Sec-Fetch-Mode", value: "navigate" },
          { name: "Sec-Fetch-Site", value: site },
          { name: "Sec-Fetch-User", value: "?1" },
          { name: "Upgrade-Insecure-Requests", value: "1" },
        ],
      });
    } catch { try { await cdp.send("Fetch.continueRequest", { requestId: ev.requestId }); } catch {} }
  });
}

// ============ 스텔스 ============
async function stealth(page: Page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "platform", { get: () => "Linux armv8l" });
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
  });
}

// ============ 인간화 타이핑 ============
async function humanType(page: Page, text: string) {
  for (const c of text) {
    await page.keyboard.type(c, { delay: rand(60, 140) });
    await sleep(rand(20, 70));
  }
}

// ============ 페이지 상태 체크 ============
async function pageStatus(page: Page): Promise<"ok" | "captcha" | "blocked"> {
  return page.evaluate(() => {
    const t = document.body?.innerText || "";
    if (t.includes("비정상적인 접근") || t.includes("일시적으로 제한") || (t.includes("접근이 제한") && t.includes("잠시 후"))) return "blocked";
    if (t.includes("보안 확인") || t.includes("자동입력방지") || t.includes("영수증")) return "captcha";
    return "ok";
  }) as Promise<"ok" | "captcha" | "blocked">;
}

// ============ CAPTCHA 자동 풀기 ============
async function solveCaptchaAuto(page: Page): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_CAPTCHA_ATTEMPTS; attempt++) {
    const status = await pageStatus(page);
    if (status === "ok") { log("✅ CAPTCHA 없음 (또는 이미 통과)"); return true; }
    if (status === "blocked") { log("❌ 차단 페이지", "error"); return false; }

    log(`═══ CAPTCHA 시도 ${attempt}/${MAX_CAPTCHA_ATTEMPTS} ═══`);

    // 1. 질문 텍스트 추출
    const question = await page.evaluate(() => {
      const t = document.body?.innerText || "";
      const lines = t.split("\n").map(l => l.trim()).filter(Boolean);
      // "무엇입니까" 또는 "채워주세요" 패턴
      return lines.find(l => l.includes("무엇입니까") || l.includes("채워주세요")) || "";
    });
    log(`질문: ${question || "(추출 실패)"}`);

    // 2. 영수증 이미지 추출 (셀렉터로 정확히)
    let receiptBase64 = "";
    try {
      // 영수증 이미지 셀렉터들
      const imgSelectors = [
        'img.receipt',
        'img[class*="receipt"]',
        'img[src*="receipt"]',
        'img[src*="captcha"]',
        '.captcha_area img',
        '#captchaimg',
        'img[alt*="영수증"]',
      ];

      let imgEl: any = null;
      for (const sel of imgSelectors) {
        imgEl = await page.$(sel);
        if (imgEl) { log(`  영수증 이미지 셀렉터: ${sel}`); break; }
      }

      // 폴백: 페이지 내 가장 큰 img
      if (!imgEl) {
        imgEl = await page.evaluateHandle(() => {
          const imgs = Array.from(document.querySelectorAll("img"));
          let biggest: HTMLImageElement | null = null;
          let maxArea = 0;
          for (const img of imgs) {
            const r = img.getBoundingClientRect();
            const area = r.width * r.height;
            if (area > maxArea && r.width > 100 && r.height > 100) {
              maxArea = area;
              biggest = img;
            }
          }
          return biggest;
        });
        if (imgEl) log("  영수증 이미지: 가장 큰 img 폴백");
      }

      if (imgEl && imgEl.asElement) {
        const el = imgEl.asElement();
        if (el) {
          const buf = await el.screenshot({ encoding: "binary" }) as Buffer;
          receiptBase64 = buf.toString("base64");
          log(`  영수증 이미지 캡처 완료 (${(receiptBase64.length / 1024).toFixed(1)}KB base64)`);
          // 디버깅용 파일 저장
          fs.writeFileSync(`${SCREENSHOT_DIR}/receipt-${attempt}.png`, buf);
        }
      } else if (imgEl) {
        // ElementHandle인 경우
        const buf = await imgEl.screenshot({ encoding: "binary" }) as Buffer;
        receiptBase64 = buf.toString("base64");
        log(`  영수증 이미지 캡처 완료 (${(receiptBase64.length / 1024).toFixed(1)}KB base64)`);
        fs.writeFileSync(`${SCREENSHOT_DIR}/receipt-${attempt}.png`, buf);
      }
    } catch (e: any) {
      log(`  영수증 이미지 추출 실패: ${e.message}`, "warn");
    }

    // 이미지 못 잡으면 전체 페이지 캡처
    if (!receiptBase64) {
      log("  전체 페이지 캡처로 폴백", "warn");
      const buf = await page.screenshot({ encoding: "binary" }) as Buffer;
      receiptBase64 = buf.toString("base64");
    }

    // 3. Claude Vision API로 분석
    let answer = "";
    try {
      answer = await analyzeReceiptWithClaude(receiptBase64, question);
      // 숫자만 추출 (Claude가 설명을 덧붙일 수 있으므로)
      const numMatch = answer.match(/\d+/);
      if (numMatch) answer = numMatch[0];
    } catch (e: any) {
      log(`  AI 분석 실패: ${e.message}`, "error");
      continue;
    }

    if (!answer) {
      log("  답변 없음", "warn");
      continue;
    }
    log(`  최종 답변: "${answer}"`);

    // 4. 답변 입력
    const captchaInput = await page.$('input#rcpt_answer') ||
                          await page.$('input[placeholder*="정답"]') ||
                          await page.$('input[type="text"]');

    if (!captchaInput) {
      log("  입력란 못 찾음", "error");
      continue;
    }

    await captchaInput.click();
    await sleep(200);
    // 클리어
    await captchaInput.evaluate((el: HTMLInputElement) => { el.value = ""; el.focus(); });
    await sleep(100);
    // 타이핑
    for (const c of answer) {
      await page.keyboard.type(c, { delay: rand(80, 150) });
    }
    await sleep(300);

    // 입력 확인
    const typed = await captchaInput.evaluate((el: HTMLInputElement) => el.value);
    log(`  입력 확인: "${typed}"`);

    if (typed !== answer) {
      log("  입력 불일치 → evaluate 강제 설정", "warn");
      await captchaInput.evaluate((el: HTMLInputElement, v: string) => {
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, answer);
    }

    await snap(page, `captcha-before-submit-${attempt}`);

    // 5. 확인 버튼 클릭
    let submitBtn: any = null;
    const buttons = await page.$$("button");
    for (const btn of buttons) {
      const info = await btn.evaluate((el: HTMLElement) => ({
        text: el.textContent?.trim() || "",
        visible: el.offsetParent !== null,
        type: (el as HTMLButtonElement).type,
      }));
      if (info.text.includes("확인") && info.visible) {
        submitBtn = btn;
        break;
      }
    }

    if (submitBtn) {
      await submitBtn.click();
      log("  확인 버튼 클릭 완료");
    } else {
      await page.keyboard.press("Enter");
      log("  Enter 키 제출");
    }

    // 6. 결과 대기 (navigation 또는 AJAX)
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => {});
    await sleep(2000);

    await snap(page, `captcha-after-submit-${attempt}`);

    const afterUrl = page.url();
    log(`  제출 후 URL: ${afterUrl}`);

    const afterStatus = await pageStatus(page);
    if (afterStatus === "ok") {
      log("✅ CAPTCHA 통과!");
      return true;
    }
    log(`  상태: ${afterStatus} → 다음 시도...`, "warn");
  }

  log(`CAPTCHA ${MAX_CAPTCHA_ATTEMPTS}회 실패`, "error");
  return false;
}

// ============ CDP 터치 스크롤 ============
async function touchScroll(cdp: any, page: Page, distance: number) {
  const vp = page.viewport();
  const x = vp ? Math.floor(vp.width / 2) : 200;
  const y = vp ? Math.floor(vp.height / 2) : 400;
  let s = 0;
  while (s < distance) {
    const step = rand(200, 400);
    try {
      await cdp.send("Input.synthesizeScrollGesture", {
        x, y, yDistance: -Math.floor(step), xDistance: 0,
        speed: Math.floor(rand(800, 1200)), gestureSourceType: "touch", repeatCount: 1, repeatDelayMs: 0,
      });
    } catch { await page.evaluate((d: number) => window.scrollBy(0, d), step).catch(() => {}); }
    s += step;
    await sleep(rand(100, 250));
  }
}

// ============ 메인 ============
async function main() {
  log("══════════════════════════════════════");
  log(`  자동 CAPTCHA 솔버 + 쇼핑 테스트`);
  log(`  키워드: "${KEYWORD}" | 타겟: ${TARGET_PRODUCT_INDEX}번째 상품`);
  log("══════════════════════════════════════");

  // API key 체크
  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY.length < 20) {
    log("ANTHROPIC_API_KEY 없음!", "error");
    process.exit(1);
  }
  log(`API Key: ${ANTHROPIC_API_KEY.substring(0, 15)}...`);

  const resp = await connect({
    headless: false, turnstile: true,
    args: [
      "--window-size=480,960",
      "--disable-blink-features=AutomationControlled",
      `--user-agent=${MOBILE_UA}`,
    ],
  });

  const browser = resp.browser as Browser;
  const page = resp.page as Page;
  await page.setViewport(MOBILE_VIEWPORT);
  page.setDefaultTimeout(30000);
  await stealth(page);

  const cdp = await (page as any).createCDPSession();
  await setupCDP(page, cdp);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  try {
    // ── 1. m.naver.com ──
    log("[1] m.naver.com");
    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(rand(1500, 2500));

    // ── 2. 스토어 → shopping.naver.com ──
    log("[2] 스토어 링크");
    const store = await page.$('a[data-clk="shortsho"]') || await page.$('a[href*="shopping.naver.com"]');
    if (!store) throw new Error("스토어 링크 없음");
    await store.evaluate((el: HTMLElement) => el.removeAttribute("target"));
    const sBox = await store.evaluate((el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const nav1 = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
    await page.touchscreen.tap(sBox.x, sBox.y);
    await nav1;
    await sleep(rand(2000, 3000));
    log(`  URL: ${page.url()}`);
    await snap(page, "01-store");

    // ── 3. CAPTCHA 자동 풀기 ──
    const solved = await solveCaptchaAuto(page);
    if (!solved) throw new Error("CAPTCHA 풀기 실패");

    log(`  CAPTCHA 후 URL: ${page.url()}`);
    await snap(page, "02-captcha-passed");

    // ── 4. 쇼핑홈 검색 ──
    log("[4] 쇼핑홈에서 검색");
    const curUrl = page.url();

    // 쇼핑홈이면 검색
    if (curUrl.includes("shopping.naver.com") && !curUrl.includes("query=")) {
      const searchInput = await page.$('input[placeholder*="검색"]') ||
                           await page.$('input[type="search"]') ||
                           await page.$('input[type="text"]');
      if (searchInput) {
        // CAPTCHA input이 아닌지 확인
        const isSafe = await searchInput.evaluate((el: HTMLElement) => {
          return !(document.body?.innerText || "").includes("보안 확인");
        });
        if (isSafe) {
          await searchInput.click();
          await sleep(300);
          await humanType(page, KEYWORD);
          await sleep(500);
          const nav2 = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
          await page.keyboard.press("Enter");
          await nav2;
          await sleep(rand(2000, 3000));
          log(`  검색 URL: ${page.url()}`);
        }
      }
    }

    await snap(page, "03-search-results");

    // 검색 후 또 CAPTCHA?
    if ((await pageStatus(page)) === "captcha") {
      const solved2 = await solveCaptchaAuto(page);
      if (!solved2) throw new Error("검색 후 CAPTCHA 실패");
    }

    // ── 5. 상품 로드 + 클릭 ──
    log("[5] 상품 로드");
    await touchScroll(cdp, page, 2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(800);

    log(`[6] ${TARGET_PRODUCT_INDEX}번째 상품 찾기`);
    const products = await page.evaluate((idx: number) => {
      const anchors = document.querySelectorAll("a[data-shp-contents-id]");
      const list: { mid: string; text: string; i: number }[] = [];
      let seq = 0;
      for (const a of anchors) {
        const inv = a.getAttribute("data-shp-inventory") || "";
        if (/lst\*(A|P|D)/.test(inv)) continue;
        seq++;
        list.push({
          mid: a.getAttribute("data-shp-contents-id") || "",
          text: (a.textContent || "").replace(/\s+/g, " ").trim().substring(0, 50),
          i: seq,
        });
      }
      return { total: list.length, top5: list.slice(0, 5), target: list.find(p => p.i === idx) };
    }, TARGET_PRODUCT_INDEX);

    log(`  총 상품: ${products.total}개`);
    products.top5.forEach((p: any) => log(`  #${p.i}: [${p.mid}] ${p.text}${p.i === TARGET_PRODUCT_INDEX ? " ◀" : ""}`));

    if (!products.target) throw new Error(`${TARGET_PRODUCT_INDEX}번째 상품 없음`);

    const link = await page.$(`a[data-shp-contents-id="${products.target.mid}"]`);
    if (!link) throw new Error("상품 링크 없음");

    await link.evaluate((el: Element) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
    await sleep(rand(500, 1000));
    await snap(page, "04-before-click");

    const pBox = await link.evaluate((el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });

    log("[7] 상품 클릭");
    const nav3 = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
    if (pBox) await page.touchscreen.tap(pBox.x, pBox.y);
    else await link.click();
    await nav3;
    await sleep(rand(2000, 3500));

    if ((await pageStatus(page)) === "captcha") {
      await solveCaptchaAuto(page);
      await sleep(2000);
    }

    const finalUrl = page.url();
    log(`최종 URL: ${finalUrl}`);
    await snap(page, "05-product-detail");

    const isProduct = finalUrl.includes("smartstore") || finalUrl.includes("brand.naver") ||
                      finalUrl.includes("window-products") || finalUrl.includes("/products/");

    log("══════════════════════════════════════");
    log(`결과: ${isProduct ? "✅ 성공" : "❌ 실패"}`);
    log(`URL: ${finalUrl}`);
    log("══════════════════════════════════════");

    if (isProduct) {
      await sleep(rand(3000, 5000));
      await touchScroll(cdp, page, 1500);
      await snap(page, "06-final");
    }

  } catch (e: any) {
    log(`FATAL: ${e.message}`, "error");
    await snap(page, "99-error");
  }

  log("브라우저 유지 중. Ctrl+C로 종료.");
  await new Promise(() => {});
}

process.on("uncaughtException", (err) => {
  const msg = err.message || "";
  if ((msg.includes("EPERM") || msg.includes("ENOENT")) && (msg.includes("temp") || msg.includes("lighthouse"))) return;
  console.error("[UNCAUGHT]", err);
  process.exit(1);
});

main().catch(console.error);
