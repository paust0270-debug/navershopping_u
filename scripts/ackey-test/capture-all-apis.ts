/**
 * 전체 API 포인트 캡처
 *
 * m.naver.com → 자동완성 → 상품 클릭 과정에서 발생하는 모든 POST 요청 확인
 */

import { chromium } from "patchright";

const TEST_PRODUCT = {
  keyword: "플리바바",
  nvMid: "90150262649"
};

interface ApiCapture {
  idx: number;
  method: string;
  url: string;
  domain: string;
  path: string;
  hasBody: boolean;
  bodyPreview?: string;
}

async function captureAllApis() {
  console.log("=== 전체 API 포인트 캡처 ===\n");

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
  const allApis: ApiCapture[] = [];

  // 모든 POST 요청 캡처
  page.on("request", req => {
    const method = req.method();
    if (method === "POST") {
      const url = req.url();
      const urlObj = new URL(url);
      const postData = req.postData();

      allApis.push({
        idx: allApis.length + 1,
        method,
        url,
        domain: urlObj.hostname,
        path: urlObj.pathname,
        hasBody: !!postData,
        bodyPreview: postData ? postData.substring(0, 100) : undefined
      });

      console.log(`[${allApis.length}] POST ${urlObj.hostname}${urlObj.pathname.substring(0, 50)}`);
    }
  });

  try {
    // 1단계: m.naver.com
    console.log("\n1단계: m.naver.com 접속...");
    await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2단계: 검색창 활성화
    console.log("\n2단계: 검색창 활성화...");
    const searchBtn = await page.$("#MM_SEARCH_FAKE");
    if (searchBtn) await searchBtn.click();
    await page.waitForTimeout(1000);

    // 3단계: 키워드 입력
    console.log(`\n3단계: 키워드 입력 (${TEST_PRODUCT.keyword})...`);
    const input = await page.$("#query");
    if (input) {
      await input.click();
      for (const char of TEST_PRODUCT.keyword) {
        await page.keyboard.type(char, { delay: 100 });
      }
    }
    await page.waitForTimeout(2000);

    // 4단계: 자동완성 클릭
    console.log("\n4단계: 자동완성 클릭...");
    const items = await page.$$("li.u_atcp_l");
    console.log(`  자동완성 항목: ${items.length}개`);
    if (items.length > 0) {
      await items[0].click();
      await page.waitForTimeout(3000);
    }

    // 5단계: 상품 클릭
    console.log(`\n5단계: MID ${TEST_PRODUCT.nvMid} 상품 찾기...`);
    for (let i = 0; i < 10; i++) {
      const link = await page.$(`a[href*="${TEST_PRODUCT.nvMid}"]`);
      if (link) {
        console.log("  상품 발견! 클릭...");
        await link.click();
        await page.waitForTimeout(8000);
        break;
      }
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(300);
    }

    // 결과 출력
    console.log("\n\n========================================");
    console.log("=== 캡처된 모든 POST API 요청 ===");
    console.log("========================================\n");

    // 도메인별 분류
    const byDomain = new Map<string, ApiCapture[]>();
    allApis.forEach(api => {
      const list = byDomain.get(api.domain) || [];
      list.push(api);
      byDomain.set(api.domain, list);
    });

    byDomain.forEach((apis, domain) => {
      console.log(`\n[${domain}] - ${apis.length}개`);
      apis.forEach(api => {
        console.log(`  ${api.idx}. ${api.path.substring(0, 60)}`);
        if (api.bodyPreview) {
          console.log(`     body: ${api.bodyPreview.substring(0, 80)}...`);
        }
      });
    });

    // 의심 API 하이라이트
    console.log("\n\n========================================");
    console.log("=== 의심되는 API 포인트 ===");
    console.log("========================================\n");

    const suspiciousKeywords = ["log", "track", "beacon", "event", "stat", "analytics", "collect"];
    allApis.forEach(api => {
      const pathLower = api.path.toLowerCase();
      const urlLower = api.url.toLowerCase();

      const matched = suspiciousKeywords.filter(kw => pathLower.includes(kw) || urlLower.includes(kw));
      if (matched.length > 0) {
        console.log(`⚠️  [${api.idx}] ${api.domain}${api.path}`);
        console.log(`    매칭: ${matched.join(", ")}`);
        if (api.bodyPreview) {
          console.log(`    body: ${api.bodyPreview}`);
        }
      }
    });

  } finally {
    console.log("\n\n5초 후 브라우저 종료...");
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

captureAllApis();
