/**
 * 테스트 1, 2, 3, 5 통합 실행 (각 1000회)
 *
 * Test 1: 고정 ackey로 product-logs 1000회
 * Test 2: 랜덤 ackey로 product-logs 1000회
 * Test 3: 전체 흐름 (WCS + ambulance + product-logs) 1000회
 * Test 5: crd/rd + product-logs 정확한 흐름 1000회
 */

import { chromium, type Page, type BrowserContext } from "patchright";
import * as fs from "fs";
import * as path from "path";

const TOTAL_REQUESTS = 1000;

const TEST_PRODUCT = {
  keyword: "또봇V",
  query: "또봇v 마스터v",
  queryEncoded: "%EB%98%90%EB%B4%87v+%EB%A7%88%EC%8A%A4%ED%84%B0v",
  acq: "또봇V",
  acqEncoded: "%EB%98%90%EB%B4%87V",
  nvMid: "82400534098",
  productId: "4856010799",
  storeUrl: "sd2gb2"
};

const RESULT_DIR = path.join(__dirname, "results");

interface TestResult {
  testName: string;
  totalRequests: number;
  success: number;
  fail: number;
  successRate: string;
  startTime: string;
  endTime: string;
  durationMs: number;
}

function generateAckey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function setupBrowser(): Promise<{ browser: any; ctx: BrowserContext; page: Page }> {
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
  return { browser, ctx, page };
}

async function navigateToProduct(page: Page): Promise<{ capturedBody: any; capturedUrl: string } | null> {
  let capturedBody: any = null;
  let capturedUrl = "";

  const handler = (req: any) => {
    if (req.url().includes("product-logs") && req.method() === "POST") {
      const postData = req.postData();
      if (postData) {
        try {
          capturedBody = JSON.parse(postData);
          capturedUrl = req.url();
        } catch {}
      }
    }
  };

  page.on("request", handler);

  try {
    await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    const searchBtn = await page.$("#MM_SEARCH_FAKE");
    if (searchBtn) await searchBtn.click();
    await page.waitForTimeout(1000);

    const input = await page.$("#query");
    if (input) {
      await input.click();
      for (const char of TEST_PRODUCT.keyword) {
        await page.keyboard.type(char, { delay: 80 });
      }
    }
    await page.waitForTimeout(2000);

    const items = await page.$$("li.u_atcp_l");
    if (items.length > 0) {
      await items[0].click();
      await page.waitForTimeout(3000);
    }

    for (let i = 0; i < 15; i++) {
      const link = await page.$(`a[href*="${TEST_PRODUCT.nvMid}"]`);
      if (link) {
        await link.click();
        await page.waitForTimeout(4000);
        break;
      }
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(400);
    }

    page.off("request", handler);

    if (capturedBody && capturedUrl) {
      return { capturedBody, capturedUrl };
    }
    return null;
  } catch (e) {
    page.off("request", handler);
    return null;
  }
}

// ============================================================
// Test 1: 고정 ackey로 product-logs 1000회
// ============================================================
async function runTest1(): Promise<TestResult> {
  console.log("\n" + "=".repeat(60));
  console.log("=== Test 1: 고정 ackey로 product-logs 1000회 ===");
  console.log("=".repeat(60) + "\n");

  const startTime = new Date();
  const fixedAckey = generateAckey(); // 테스트 시작 시 한번만 생성
  console.log(`고정 ackey: ${fixedAckey}\n`);

  const { browser, ctx, page } = await setupBrowser();
  let success = 0;
  let fail = 0;

  try {
    const captured = await navigateToProduct(page);
    if (!captured) {
      console.log("❌ product-logs 캡처 실패");
      return { testName: "Test1", totalRequests: TOTAL_REQUESTS, success: 0, fail: TOTAL_REQUESTS, successRate: "0%", startTime: startTime.toISOString(), endTime: new Date().toISOString(), durationMs: 0 };
    }

    console.log("✅ 캡처 완료, 1000회 전송 시작...\n");

    const referer = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${TEST_PRODUCT.queryEncoded}&ackey=${fixedAckey}&acq=${TEST_PRODUCT.acqEncoded}&acr=5&qdt=0`;

    for (let i = 1; i <= TOTAL_REQUESTS; i++) {
      const body = { ...captured.capturedBody, referer };

      const result = await page.evaluate(
        async ({ url, body }) => {
          try {
            const res = await fetch(url, {
              method: "POST",
              headers: {
                "accept": "application/json",
                "content-type": "application/json",
                "useshopfegw": "true",
                "x-client-version": "20251215200000"
              },
              body: JSON.stringify(body),
              credentials: "include"
            });
            return res.status;
          } catch { return 0; }
        },
        { url: captured.capturedUrl, body }
      );

      if (result >= 200 && result < 300) success++;
      else fail++;

      if (i % 100 === 0 || i === TOTAL_REQUESTS) {
        process.stdout.write(`\r[Test1] ${i}/${TOTAL_REQUESTS} | 성공: ${success} | 실패: ${fail}`);
      }

      await page.waitForTimeout(30);
    }

  } finally {
    await browser.close();
  }

  const endTime = new Date();
  const result: TestResult = {
    testName: "Test1_FixedAckey",
    totalRequests: TOTAL_REQUESTS,
    success,
    fail,
    successRate: `${(success/TOTAL_REQUESTS*100).toFixed(1)}%`,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    durationMs: endTime.getTime() - startTime.getTime()
  };

  console.log(`\n\n✅ Test 1 완료: ${success}/${TOTAL_REQUESTS} (${result.successRate})\n`);
  return result;
}

// ============================================================
// Test 2: 랜덤 ackey로 product-logs 1000회
// ============================================================
async function runTest2(): Promise<TestResult> {
  console.log("\n" + "=".repeat(60));
  console.log("=== Test 2: 랜덤 ackey로 product-logs 1000회 ===");
  console.log("=".repeat(60) + "\n");

  const startTime = new Date();
  const { browser, ctx, page } = await setupBrowser();
  let success = 0;
  let fail = 0;

  try {
    const captured = await navigateToProduct(page);
    if (!captured) {
      console.log("❌ product-logs 캡처 실패");
      return { testName: "Test2", totalRequests: TOTAL_REQUESTS, success: 0, fail: TOTAL_REQUESTS, successRate: "0%", startTime: startTime.toISOString(), endTime: new Date().toISOString(), durationMs: 0 };
    }

    console.log("✅ 캡처 완료, 1000회 전송 시작...\n");

    for (let i = 1; i <= TOTAL_REQUESTS; i++) {
      const randomAckey = generateAckey();
      const referer = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${TEST_PRODUCT.queryEncoded}&ackey=${randomAckey}&acq=${TEST_PRODUCT.acqEncoded}&acr=5&qdt=0`;
      const body = { ...captured.capturedBody, referer };

      const result = await page.evaluate(
        async ({ url, body }) => {
          try {
            const res = await fetch(url, {
              method: "POST",
              headers: {
                "accept": "application/json",
                "content-type": "application/json",
                "useshopfegw": "true",
                "x-client-version": "20251215200000"
              },
              body: JSON.stringify(body),
              credentials: "include"
            });
            return res.status;
          } catch { return 0; }
        },
        { url: captured.capturedUrl, body }
      );

      if (result >= 200 && result < 300) success++;
      else fail++;

      if (i % 100 === 0 || i === TOTAL_REQUESTS) {
        process.stdout.write(`\r[Test2] ${i}/${TOTAL_REQUESTS} | 성공: ${success} | 실패: ${fail}`);
      }

      await page.waitForTimeout(30);
    }

  } finally {
    await browser.close();
  }

  const endTime = new Date();
  const result: TestResult = {
    testName: "Test2_RandomAckey",
    totalRequests: TOTAL_REQUESTS,
    success,
    fail,
    successRate: `${(success/TOTAL_REQUESTS*100).toFixed(1)}%`,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    durationMs: endTime.getTime() - startTime.getTime()
  };

  console.log(`\n\n✅ Test 2 완료: ${success}/${TOTAL_REQUESTS} (${result.successRate})\n`);
  return result;
}

// ============================================================
// Test 3: 전체 흐름 (WCS + ambulance + product-logs) 1000회
// ============================================================
async function runTest3(): Promise<TestResult> {
  console.log("\n" + "=".repeat(60));
  console.log("=== Test 3: 전체 흐름 (WCS + ambulance + product-logs) 1000회 ===");
  console.log("=".repeat(60) + "\n");

  const startTime = new Date();
  const { browser, ctx, page } = await setupBrowser();
  let success = 0;
  let fail = 0;

  try {
    const captured = await navigateToProduct(page);
    if (!captured) {
      console.log("❌ product-logs 캡처 실패");
      return { testName: "Test3", totalRequests: TOTAL_REQUESTS, success: 0, fail: TOTAL_REQUESTS, successRate: "0%", startTime: startTime.toISOString(), endTime: new Date().toISOString(), durationMs: 0 };
    }

    console.log("✅ 캡처 완료, 1000회 전송 시작...\n");

    for (let i = 1; i <= TOTAL_REQUESTS; i++) {
      const randomAckey = generateAckey();
      const referer = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${TEST_PRODUCT.queryEncoded}&ackey=${randomAckey}&acq=${TEST_PRODUCT.acqEncoded}&acr=5&qdt=0`;

      // 전체 흐름: WCS 비콘 + ambulance + product-logs
      const result = await page.evaluate(
        async ({ productLogsUrl, body, referer, storeUrl, productId }) => {
          let plSuccess = false;

          // 1. WCS 비콘 (이미지로 전송)
          try {
            const wcsImg = new Image();
            wcsImg.src = `https://wcs.naver.net/wcslog.gif?_lptag=MTJPD|${Date.now()}`;
          } catch {}

          // 2. ambulance/pages
          try {
            await fetch(`https://m.smartstore.naver.com/${storeUrl}/i/v1/ambulance/pages`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                url: `https://m.smartstore.naver.com/${storeUrl}/products/${productId}`,
                pathType: "PRODUCT",
                referer: referer
              }),
              credentials: "include"
            });
          } catch {}

          // 3. product-logs
          try {
            const res = await fetch(productLogsUrl, {
              method: "POST",
              headers: {
                "accept": "application/json",
                "content-type": "application/json",
                "useshopfegw": "true",
                "x-client-version": "20251215200000"
              },
              body: JSON.stringify({ ...body, referer }),
              credentials: "include"
            });
            plSuccess = res.ok;
          } catch {}

          return plSuccess;
        },
        {
          productLogsUrl: captured.capturedUrl,
          body: captured.capturedBody,
          referer,
          storeUrl: TEST_PRODUCT.storeUrl,
          productId: TEST_PRODUCT.productId
        }
      );

      if (result) success++;
      else fail++;

      if (i % 100 === 0 || i === TOTAL_REQUESTS) {
        process.stdout.write(`\r[Test3] ${i}/${TOTAL_REQUESTS} | 성공: ${success} | 실패: ${fail}`);
      }

      await page.waitForTimeout(50);
    }

  } finally {
    await browser.close();
  }

  const endTime = new Date();
  const result: TestResult = {
    testName: "Test3_FullFlow",
    totalRequests: TOTAL_REQUESTS,
    success,
    fail,
    successRate: `${(success/TOTAL_REQUESTS*100).toFixed(1)}%`,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    durationMs: endTime.getTime() - startTime.getTime()
  };

  console.log(`\n\n✅ Test 3 완료: ${success}/${TOTAL_REQUESTS} (${result.successRate})\n`);
  return result;
}

// ============================================================
// Test 5: crd/rd + product-logs 정확한 흐름 1000회
// ============================================================
async function runTest5(): Promise<TestResult> {
  console.log("\n" + "=".repeat(60));
  console.log("=== Test 5: crd/rd + product-logs 정확한 흐름 1000회 ===");
  console.log("=".repeat(60) + "\n");

  const startTime = new Date();
  const { browser, ctx, page } = await setupBrowser();
  let success = 0;
  let fail = 0;
  let crdSuccess = 0;
  let plSuccess = 0;

  let capturedProductLogBody: any = null;
  let lastCrdStatus = 0;
  let lastPlStatus = 0;

  page.on("request", req => {
    if (req.url().includes("product-logs") && req.method() === "POST") {
      const postData = req.postData();
      if (postData) {
        try { capturedProductLogBody = JSON.parse(postData); } catch {}
      }
    }
  });

  page.on("response", res => {
    if (res.url().includes("crd/rd")) lastCrdStatus = res.status();
    if (res.url().includes("product-logs")) lastPlStatus = res.status();
  });

  try {
    // 초기 진입
    console.log("초기 진입 중...\n");

    await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    const searchBtn = await page.$("#MM_SEARCH_FAKE");
    if (searchBtn) await searchBtn.click();
    await page.waitForTimeout(1000);

    const input = await page.$("#query");
    if (input) {
      await input.click();
      for (const char of TEST_PRODUCT.keyword) {
        await page.keyboard.type(char, { delay: 80 });
      }
    }
    await page.waitForTimeout(2000);

    const items = await page.$$("li.u_atcp_l");
    if (items.length > 0) {
      await items[0].click();
      await page.waitForTimeout(3000);
    }

    console.log("✅ 검색 결과 페이지 진입, 1000회 반복 시작...\n");

    for (let i = 1; i <= TOTAL_REQUESTS; i++) {
      lastCrdStatus = 0;
      lastPlStatus = 0;

      const ackey = generateAckey();

      // 상품 찾기 및 클릭
      let found = false;
      for (let scroll = 0; scroll < 10; scroll++) {
        const link = await page.$(`a[href*="${TEST_PRODUCT.nvMid}"]`);
        if (link) {
          found = true;
          await link.click();
          await page.waitForTimeout(2500);
          break;
        }
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(200);
      }

      if (!found) {
        fail++;
        continue;
      }

      // 상품 페이지에서 추가 product-logs 전송
      if (capturedProductLogBody) {
        const newReferer = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${TEST_PRODUCT.queryEncoded}&ackey=${ackey}&acq=${TEST_PRODUCT.acqEncoded}&acr=5&qdt=0`;

        const plResult = await page.evaluate(
          async ({ url, body, newReferer }) => {
            try {
              const res = await fetch(url, {
                method: "POST",
                headers: {
                  "accept": "application/json",
                  "content-type": "application/json",
                  "useshopfegw": "true",
                  "x-client-version": "20251215200000"
                },
                body: JSON.stringify({ ...body, referer: newReferer }),
                credentials: "include"
              });
              return res.status;
            } catch { return 0; }
          },
          {
            url: `https://m.smartstore.naver.com/i/v1/product-logs/${TEST_PRODUCT.productId}`,
            body: capturedProductLogBody,
            newReferer
          }
        );

        lastPlStatus = plResult;
      }

      const crdOk = lastCrdStatus >= 200 && lastCrdStatus < 300;
      const plOk = lastPlStatus >= 200 && lastPlStatus < 300;

      if (crdOk) crdSuccess++;
      if (plOk) plSuccess++;
      if (crdOk && plOk) success++;
      else fail++;

      if (i % 50 === 0 || i === TOTAL_REQUESTS) {
        process.stdout.write(`\r[Test5] ${i}/${TOTAL_REQUESTS} | crd:${crdSuccess} pl:${plSuccess} both:${success}`);
      }

      // 뒤로가기
      await page.goBack({ waitUntil: "load" });
      await page.waitForTimeout(800);
    }

  } finally {
    await browser.close();
  }

  const endTime = new Date();
  const result: TestResult = {
    testName: "Test5_CrdAndProductLogs",
    totalRequests: TOTAL_REQUESTS,
    success,
    fail,
    successRate: `${(success/TOTAL_REQUESTS*100).toFixed(1)}%`,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    durationMs: endTime.getTime() - startTime.getTime()
  };

  console.log(`\n\n✅ Test 5 완료: crd=${crdSuccess} pl=${plSuccess} both=${success}/${TOTAL_REQUESTS} (${result.successRate})\n`);
  return result;
}

// ============================================================
// 메인 실행
// ============================================================
async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("=== 테스트 1, 2, 3, 5 통합 실행 (각 1000회) ===");
  console.log("=".repeat(60));
  console.log(`상품: ${TEST_PRODUCT.keyword} (MID: ${TEST_PRODUCT.nvMid})`);
  console.log(`각 테스트: ${TOTAL_REQUESTS}회`);
  console.log("=".repeat(60) + "\n");

  const allResults: TestResult[] = [];

  // Test 1
  const result1 = await runTest1();
  allResults.push(result1);

  // Test 2
  const result2 = await runTest2();
  allResults.push(result2);

  // Test 3
  const result3 = await runTest3();
  allResults.push(result3);

  // Test 5
  const result5 = await runTest5();
  allResults.push(result5);

  // 최종 결과 출력
  console.log("\n" + "=".repeat(60));
  console.log("=== 최종 결과 ===");
  console.log("=".repeat(60) + "\n");

  allResults.forEach(r => {
    const duration = Math.round(r.durationMs / 1000);
    console.log(`${r.testName}: ${r.success}/${r.totalRequests} (${r.successRate}) - ${duration}초`);
  });

  // 결과 저장
  if (!fs.existsSync(RESULT_DIR)) {
    fs.mkdirSync(RESULT_DIR, { recursive: true });
  }

  const filename = path.join(RESULT_DIR, `all_tests_1000_${new Date().toISOString().split("T")[0]}.json`);
  fs.writeFileSync(filename, JSON.stringify({
    product: TEST_PRODUCT,
    totalRequestsPerTest: TOTAL_REQUESTS,
    results: allResults,
    timestamp: new Date().toISOString()
  }, null, 2), "utf-8");

  console.log(`\n결과 저장: ${filename}`);
}

main().catch(console.error);
