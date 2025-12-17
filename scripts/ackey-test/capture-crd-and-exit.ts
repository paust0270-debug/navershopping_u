/**
 * crd/rd 상세 분석 + 상세페이지 이탈 로그 캡처
 *
 * 1. crd/rd 요청의 상세 페이로드 확인
 * 2. 상세페이지 진입 후 이탈(뒤로가기/다른페이지) 시 어떤 로그가 전송되는지
 */

import { chromium } from "patchright";

const TEST_PRODUCT = {
  keyword: "플리바바",
  nvMid: "90150262649"
};

interface DetailedCapture {
  timestamp: number;
  phase: string;
  method: string;
  url: string;
  domain: string;
  path: string;
  headers: Record<string, string>;
  body: any;
  bodyRaw: string;
}

async function captureCrdAndExit() {
  console.log("=== crd/rd 상세 + 이탈 로그 캡처 ===\n");

  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--window-size=450,900"]
  });

  const ctx = await browser.newContext({
    viewport: { width: 412, height: 900 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36"
  });

  const page = await ctx.newPage();
  const allCaptures: DetailedCapture[] = [];
  let currentPhase = "init";

  // 모든 POST 요청 상세 캡처
  page.on("request", req => {
    const method = req.method();
    if (method === "POST") {
      const url = req.url();
      const urlObj = new URL(url);
      const postData = req.postData() || "";

      let bodyParsed: any = null;
      try {
        bodyParsed = JSON.parse(postData);
      } catch {
        bodyParsed = postData;
      }

      const capture: DetailedCapture = {
        timestamp: Date.now(),
        phase: currentPhase,
        method,
        url,
        domain: urlObj.hostname,
        path: urlObj.pathname,
        headers: req.headers(),
        body: bodyParsed,
        bodyRaw: postData.substring(0, 500)
      };

      allCaptures.push(capture);

      // crd/rd 또는 중요 API만 실시간 출력
      if (
        url.includes("crd/rd") ||
        url.includes("product-logs") ||
        url.includes("ambulance") ||
        url.includes("scrolllog") ||
        url.includes("nlog.commerce") ||
        url.includes("unload") ||
        url.includes("leave") ||
        url.includes("exit") ||
        url.includes("beacon")
      ) {
        console.log(`[${currentPhase}] ⚠️ ${urlObj.hostname}${urlObj.pathname.substring(0, 50)}`);
      }
    }
  });

  try {
    // ========== Phase 1: m.naver.com ==========
    currentPhase = "1_naver_main";
    console.log("\n========== Phase 1: m.naver.com 접속 ==========");
    await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // ========== Phase 2: 검색창 ==========
    currentPhase = "2_search_input";
    console.log("\n========== Phase 2: 검색창 활성화 + 입력 ==========");
    const searchBtn = await page.$("#MM_SEARCH_FAKE");
    if (searchBtn) await searchBtn.click();
    await page.waitForTimeout(1000);

    const input = await page.$("#query");
    if (input) {
      await input.click();
      for (const char of TEST_PRODUCT.keyword) {
        await page.keyboard.type(char, { delay: 100 });
      }
    }
    await page.waitForTimeout(2000);

    // ========== Phase 3: 자동완성 클릭 ==========
    currentPhase = "3_autocomplete_click";
    console.log("\n========== Phase 3: 자동완성 클릭 ==========");
    const items = await page.$$("li.u_atcp_l");
    console.log(`  자동완성 항목: ${items.length}개`);
    if (items.length > 0) {
      await items[0].click();
      await page.waitForTimeout(3000);
    }

    // ========== Phase 4: 상품 클릭 (crd/rd 발생 지점) ==========
    currentPhase = "4_product_click";
    console.log("\n========== Phase 4: 상품 클릭 (crd/rd 발생) ==========");
    for (let i = 0; i < 10; i++) {
      const link = await page.$(`a[href*="${TEST_PRODUCT.nvMid}"]`);
      if (link) {
        console.log("  상품 발견! 클릭...");
        await link.click();
        break;
      }
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(5000);

    // ========== Phase 5: 상세페이지 체류 ==========
    currentPhase = "5_product_page_dwell";
    console.log("\n========== Phase 5: 상세페이지 체류 (10초) ==========");

    // 스크롤 시뮬레이션
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(1000);
    }

    await page.waitForTimeout(5000);

    // ========== Phase 6: 뒤로가기 (이탈) ==========
    currentPhase = "6_back_exit";
    console.log("\n========== Phase 6: 뒤로가기 (이탈 로그 캡처) ==========");
    await page.goBack({ waitUntil: "load" });
    await page.waitForTimeout(3000);

    // ========== Phase 7: 다시 상품 클릭 ==========
    currentPhase = "7_product_click_again";
    console.log("\n========== Phase 7: 다시 상품 클릭 ==========");
    const link2 = await page.$(`a[href*="${TEST_PRODUCT.nvMid}"]`);
    if (link2) {
      await link2.click();
      await page.waitForTimeout(5000);
    }

    // ========== Phase 8: 브라우저 닫기 전 이탈 ==========
    currentPhase = "8_final_exit";
    console.log("\n========== Phase 8: 다른 페이지로 이동 (최종 이탈) ==========");
    await page.goto("https://m.naver.com", { waitUntil: "load" });
    await page.waitForTimeout(3000);

    // ========== 결과 분석 ==========
    console.log("\n\n========================================");
    console.log("=== crd/rd 상세 분석 ===");
    console.log("========================================\n");

    const crdCaptures = allCaptures.filter(c => c.url.includes("crd/rd"));
    if (crdCaptures.length > 0) {
      crdCaptures.forEach((c, i) => {
        console.log(`\n[crd/rd #${i + 1}] Phase: ${c.phase}`);
        console.log(`  URL: ${c.url}`);
        console.log(`  Headers:`);
        console.log(`    referer: ${c.headers.referer?.substring(0, 100) || "없음"}`);
        console.log(`    content-type: ${c.headers["content-type"]}`);
        console.log(`  Body (raw): ${c.bodyRaw.substring(0, 300)}`);

        if (typeof c.body === "object") {
          console.log(`  Body (parsed):`);
          Object.entries(c.body).forEach(([k, v]) => {
            const vStr = typeof v === "string" ? v.substring(0, 80) : JSON.stringify(v).substring(0, 80);
            console.log(`    ${k}: ${vStr}`);
          });
        }
      });
    } else {
      console.log("crd/rd 요청 없음");
    }

    // 이탈 관련 로그 분석
    console.log("\n\n========================================");
    console.log("=== 이탈 시점 로그 분석 ===");
    console.log("========================================\n");

    const exitPhases = ["6_back_exit", "8_final_exit"];
    const exitCaptures = allCaptures.filter(c => exitPhases.includes(c.phase));

    if (exitCaptures.length > 0) {
      console.log(`이탈 시점 POST 요청: ${exitCaptures.length}개\n`);
      exitCaptures.forEach((c, i) => {
        console.log(`[${i + 1}] ${c.domain}${c.path.substring(0, 50)}`);
        console.log(`    Phase: ${c.phase}`);
        if (c.bodyRaw) {
          console.log(`    Body: ${c.bodyRaw.substring(0, 150)}...`);
        }
      });
    } else {
      console.log("이탈 시점 POST 요청 없음 (비콘은 sendBeacon으로 전송될 수 있음)");
    }

    // Phase별 요약
    console.log("\n\n========================================");
    console.log("=== Phase별 POST 요청 요약 ===");
    console.log("========================================\n");

    const byPhase = new Map<string, DetailedCapture[]>();
    allCaptures.forEach(c => {
      const list = byPhase.get(c.phase) || [];
      list.push(c);
      byPhase.set(c.phase, list);
    });

    byPhase.forEach((captures, phase) => {
      console.log(`\n[${phase}] - ${captures.length}개`);
      const domains = new Map<string, number>();
      captures.forEach(c => {
        domains.set(c.domain, (domains.get(c.domain) || 0) + 1);
      });
      domains.forEach((count, domain) => {
        console.log(`  - ${domain}: ${count}개`);
      });
    });

    // ambulance 로그 상세
    console.log("\n\n========================================");
    console.log("=== ambulance 로그 상세 (체류/이탈 관련) ===");
    console.log("========================================\n");

    const ambulanceCaptures = allCaptures.filter(c => c.url.includes("ambulance"));
    ambulanceCaptures.forEach((c, i) => {
      console.log(`[${i + 1}] ${c.path} (Phase: ${c.phase})`);
      if (typeof c.body === "object") {
        // 주요 필드만 출력
        const keys = ["pageUrl", "pathType", "dwellTime", "scrollDepth", "exitType"];
        keys.forEach(k => {
          if (c.body[k] !== undefined) {
            console.log(`    ${k}: ${c.body[k]}`);
          }
        });
      }
    });

  } finally {
    console.log("\n\n5초 후 브라우저 종료...");
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

captureCrdAndExit();
