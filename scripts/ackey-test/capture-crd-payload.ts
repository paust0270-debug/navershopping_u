/**
 * crd/rd 페이로드 캡처
 *
 * 또봇V 상품으로 자동완성 클릭 → crd/rd 상세 캡처
 */

import { chromium } from "patchright";
import * as fs from "fs";

const TEST_PRODUCT = {
  keyword: "또봇V",
  query: "또봇V 미니 킹포트란 마스터v 세트 변신 로봇 자동차 장난감",
  nvMid: "82400534098"
};

interface CrdCapture {
  timestamp: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData: string;
  postDataParsed: any;
}

async function captureCrdPayload() {
  console.log("=== crd/rd 페이로드 캡처 ===\n");
  console.log(`키워드: ${TEST_PRODUCT.keyword}`);
  console.log(`MID: ${TEST_PRODUCT.nvMid}`);
  console.log(`쿼리: ${TEST_PRODUCT.query}\n`);

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
    userAgent: "Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
  });

  const page = await ctx.newPage();
  const crdCaptures: CrdCapture[] = [];
  const productLogsCaptures: CrdCapture[] = [];

  // crd/rd 및 product-logs 캡처
  page.on("request", req => {
    const url = req.url();
    const method = req.method();

    if (url.includes("crd/rd") && method === "POST") {
      const capture: CrdCapture = {
        timestamp: Date.now(),
        url,
        method,
        headers: req.headers(),
        postData: req.postData() || "",
        postDataParsed: null
      };

      try {
        capture.postDataParsed = JSON.parse(capture.postData);
      } catch {
        // URL encoded or other format
      }

      crdCaptures.push(capture);
      console.log(`\n⚠️ [crd/rd 캡처] ${url.substring(0, 80)}`);
      console.log(`   PostData: ${capture.postData.substring(0, 200)}...`);
    }

    if (url.includes("product-logs") && method === "POST") {
      const capture: CrdCapture = {
        timestamp: Date.now(),
        url,
        method,
        headers: req.headers(),
        postData: req.postData() || "",
        postDataParsed: null
      };

      try {
        capture.postDataParsed = JSON.parse(capture.postData);
      } catch {}

      productLogsCaptures.push(capture);
      console.log(`\n✅ [product-logs 캡처] ${url.substring(0, 80)}`);
    }
  });

  try {
    // 1. m.naver.com 접속
    console.log("\n1. m.naver.com 접속...");
    await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. 검색창 활성화
    console.log("2. 검색창 활성화...");
    const searchBtn = await page.$("#MM_SEARCH_FAKE");
    if (searchBtn) await searchBtn.click();
    await page.waitForTimeout(1000);

    // 3. 키워드 입력
    console.log(`3. 키워드 입력: ${TEST_PRODUCT.keyword}`);
    const input = await page.$("#query");
    if (input) {
      await input.click();
      for (const char of TEST_PRODUCT.keyword) {
        await page.keyboard.type(char, { delay: 120 });
      }
    }
    await page.waitForTimeout(2000);

    // 4. 자동완성 클릭
    console.log("4. 자동완성 항목 클릭...");
    const items = await page.$$("li.u_atcp_l");
    console.log(`   자동완성 항목: ${items.length}개`);
    if (items.length > 0) {
      await items[0].click();
      await page.waitForTimeout(3000);
    }

    // 5. 상품 찾기 및 클릭
    console.log(`\n5. MID ${TEST_PRODUCT.nvMid} 상품 찾기...`);
    let found = false;
    for (let i = 0; i < 15; i++) {
      const link = await page.$(`a[href*="${TEST_PRODUCT.nvMid}"]`);
      if (link) {
        console.log("   ✅ 상품 발견! 클릭...");
        await link.click();
        found = true;
        break;
      }
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(500);
    }

    if (!found) {
      console.log("   ❌ 상품을 찾지 못했습니다.");
    }

    await page.waitForTimeout(5000);

    // 결과 저장
    console.log("\n\n========================================");
    console.log("=== 캡처 결과 ===");
    console.log("========================================\n");

    console.log(`crd/rd 캡처: ${crdCaptures.length}개`);
    console.log(`product-logs 캡처: ${productLogsCaptures.length}개`);

    if (crdCaptures.length > 0) {
      console.log("\n--- crd/rd 상세 ---");
      crdCaptures.forEach((c, i) => {
        console.log(`\n[${i + 1}] URL: ${c.url}`);
        console.log(`Headers:`);
        console.log(`  content-type: ${c.headers["content-type"]}`);
        console.log(`  referer: ${c.headers.referer?.substring(0, 100)}`);
        console.log(`PostData (raw): ${c.postData}`);
      });
    }

    if (productLogsCaptures.length > 0) {
      console.log("\n--- product-logs 상세 ---");
      productLogsCaptures.forEach((c, i) => {
        console.log(`\n[${i + 1}] URL: ${c.url}`);
        if (c.postDataParsed) {
          console.log(`Body.referer: ${c.postDataParsed.referer?.substring(0, 150)}`);
        }
      });
    }

    // JSON 파일로 저장
    const result = {
      product: TEST_PRODUCT,
      capturedAt: new Date().toISOString(),
      crd: crdCaptures,
      productLogs: productLogsCaptures
    };

    const filename = `scripts/ackey-test/captured/crd_${TEST_PRODUCT.keyword}_${new Date().toISOString().split("T")[0]}.json`;
    fs.writeFileSync(filename, JSON.stringify(result, null, 2), "utf-8");
    console.log(`\n\n✅ 저장됨: ${filename}`);

  } finally {
    console.log("\n5초 후 브라우저 종료...");
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

captureCrdPayload();
