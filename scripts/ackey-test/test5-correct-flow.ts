/**
 * Test 5 (정확한 흐름):
 *
 * 실제 흐름대로:
 * 1. 검색 결과 페이지에서 crd/rd 전송 (m.search.naver.com 도메인)
 * 2. 상품 페이지로 이동
 * 3. 상품 페이지에서 product-logs 전송 (m.smartstore.naver.com 도메인)
 * 4. 뒤로가기
 * 5. 1~4 반복
 */

import { chromium } from "patchright";
import * as fs from "fs";

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

const TOTAL_REQUESTS = 100;

function generateAckey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function runTest5CorrectFlow() {
  console.log("=== Test 5: 정확한 흐름 (검색→crd→상품→pl) ===\n");
  console.log(`상품: ${TEST_PRODUCT.keyword}`);
  console.log(`MID: ${TEST_PRODUCT.nvMid}`);
  console.log(`총 요청: ${TOTAL_REQUESTS}회\n`);

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

  // 캡처용 변수
  let lastCrdStatus = 0;
  let lastPlStatus = 0;
  let capturedProductLogBody: any = null;

  // 요청 모니터링
  page.on("request", req => {
    const url = req.url();
    if (url.includes("crd/rd") && req.method() === "POST") {
      // crd/rd 캡처 (브라우저가 자동 전송)
    }
    if (url.includes("product-logs") && req.method() === "POST") {
      const postData = req.postData();
      if (postData) {
        try {
          capturedProductLogBody = JSON.parse(postData);
        } catch {}
      }
    }
  });

  page.on("response", res => {
    const url = res.url();
    if (url.includes("crd/rd")) {
      lastCrdStatus = res.status();
    }
    if (url.includes("product-logs")) {
      lastPlStatus = res.status();
    }
  });

  const results: Array<{ round: number; ackey: string; crd: number; pl: number }> = [];
  let crdSuccess = 0;
  let plSuccess = 0;
  let bothSuccess = 0;

  try {
    // 초기 진입: m.naver.com → 검색 → 자동완성
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
        await page.keyboard.type(char, { delay: 100 });
      }
    }
    await page.waitForTimeout(2000);

    // 자동완성 클릭 → 검색 결과 페이지
    const items = await page.$$("li.u_atcp_l");
    if (items.length > 0) {
      await items[0].click();
      await page.waitForTimeout(3000);
    }

    console.log(`=== ${TOTAL_REQUESTS}회 반복 시작 ===\n`);

    for (let i = 1; i <= TOTAL_REQUESTS; i++) {
      lastCrdStatus = 0;
      lastPlStatus = 0;

      const ackey = generateAckey();

      // 현재 검색 결과 페이지에서 상품 찾기
      let found = false;
      for (let scroll = 0; scroll < 10; scroll++) {
        const link = await page.$(`a[href*="${TEST_PRODUCT.nvMid}"]`);
        if (link) {
          found = true;

          // 상품 클릭 전: URL에 ackey 주입 (검색 결과 URL 수정)
          // 실제로는 자동완성에서 이미 ackey가 포함되어 있음
          // 여기서는 referer가 자동으로 포함됨

          // 상품 클릭 → crd/rd 자동 발생 + 상품 페이지로 이동
          await link.click();
          await page.waitForTimeout(3000);
          break;
        }
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(300);
      }

      if (!found) {
        console.log(`\n[${i}] 상품 못찾음, 스킵`);
        continue;
      }

      // 상품 페이지에서 추가 product-logs 전송 (랜덤 ackey로)
      if (capturedProductLogBody) {
        const newReferer = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${TEST_PRODUCT.queryEncoded}&ackey=${ackey}&acq=${TEST_PRODUCT.acqEncoded}&acr=5&qdt=0`;

        const plResult = await page.evaluate(
          async ({ url, body, newReferer }) => {
            const newBody = { ...body, referer: newReferer };
            try {
              const res = await fetch(url, {
                method: "POST",
                headers: {
                  "accept": "application/json",
                  "content-type": "application/json",
                  "useshopfegw": "true",
                  "x-client-version": "20251215180000"
                },
                body: JSON.stringify(newBody),
                credentials: "include"
              });
              return res.status;
            } catch {
              return 0;
            }
          },
          {
            url: `https://m.smartstore.naver.com/i/v1/product-logs/${TEST_PRODUCT.productId}`,
            body: capturedProductLogBody,
            newReferer
          }
        );

        lastPlStatus = plResult;
      }

      // crd/rd는 브라우저가 클릭 시 자동 전송 (204)
      // 현재 lastCrdStatus는 브라우저 자동 전송 결과

      const crdOk = lastCrdStatus >= 200 && lastCrdStatus < 300;
      const plOk = lastPlStatus >= 200 && lastPlStatus < 300;

      results.push({ round: i, ackey, crd: lastCrdStatus, pl: lastPlStatus });

      if (crdOk) crdSuccess++;
      if (plOk) plSuccess++;
      if (crdOk && plOk) bothSuccess++;

      const crdIcon = crdOk ? "✅" : "❌";
      const plIcon = plOk ? "✅" : "❌";
      process.stdout.write(`\r[${i}/${TOTAL_REQUESTS}] crd:${crdIcon}(${lastCrdStatus}) pl:${plIcon}(${lastPlStatus}) ackey:${ackey}`);

      // 뒤로가기 → 검색 결과 페이지
      await page.goBack({ waitUntil: "load" });
      await page.waitForTimeout(1000);
    }

    console.log("\n\n========================================");
    console.log("=== Test 5 결과 (정확한 흐름) ===");
    console.log("========================================\n");

    console.log(`crd/rd 성공: ${crdSuccess}/${TOTAL_REQUESTS} (${(crdSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);
    console.log(`product-logs 성공: ${plSuccess}/${TOTAL_REQUESTS} (${(plSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);
    console.log(`둘 다 성공: ${bothSuccess}/${TOTAL_REQUESTS} (${(bothSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);

    // 저장
    const summary = {
      test: "Test 5: correct flow (search→crd→product→pl)",
      product: TEST_PRODUCT,
      totalRequests: TOTAL_REQUESTS,
      results: {
        crd: { success: crdSuccess, rate: `${(crdSuccess/TOTAL_REQUESTS*100).toFixed(1)}%` },
        productLogs: { success: plSuccess, rate: `${(plSuccess/TOTAL_REQUESTS*100).toFixed(1)}%` },
        both: { success: bothSuccess, rate: `${(bothSuccess/TOTAL_REQUESTS*100).toFixed(1)}%` }
      },
      timestamp: new Date().toISOString(),
      details: results
    };

    const filename = `scripts/ackey-test/results/test5_correct_${new Date().toISOString().split("T")[0]}.json`;
    fs.writeFileSync(filename, JSON.stringify(summary, null, 2), "utf-8");
    console.log(`\n결과 저장: ${filename}`);

  } finally {
    console.log("\n5초 후 브라우저 종료...");
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

runTest5CorrectFlow();
