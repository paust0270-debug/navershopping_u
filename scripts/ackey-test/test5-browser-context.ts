/**
 * Test 5 (브라우저 컨텍스트): crd/rd + product-logs 함께 전송
 *
 * 1. 브라우저로 상품 페이지 진입하여 product-logs 캡처
 * 2. 브라우저 내에서 (page.evaluate) crd/rd + product-logs 100회 전송
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

interface CapturedProductLog {
  url: string;
  headers: Record<string, string>;
  body: any;
}

function generateAckey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function runTest5BrowserContext() {
  console.log("=== Test 5: crd/rd + product-logs (브라우저 컨텍스트) ===\n");
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
  let capturedLog: CapturedProductLog | null = null;
  let capturedCrdUrl: string | null = null;

  // product-logs 및 crd/rd 캡처
  page.on("request", req => {
    const url = req.url();
    if (url.includes("product-logs") && req.method() === "POST") {
      const postData = req.postData();
      if (postData) {
        try {
          capturedLog = {
            url,
            headers: req.headers(),
            body: JSON.parse(postData)
          };
          console.log("✅ product-logs 캡처!");
        } catch {}
      }
    }
    if (url.includes("crd/rd")) {
      capturedCrdUrl = url;
      console.log("✅ crd/rd URL 캡처!");
    }
  });

  try {
    // 1. m.naver.com
    console.log("\n1. m.naver.com 접속...");
    await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. 검색창
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
        await page.keyboard.type(char, { delay: 100 });
      }
    }
    await page.waitForTimeout(2000);

    // 4. 자동완성 클릭
    console.log("4. 자동완성 클릭...");
    const items = await page.$$("li.u_atcp_l");
    if (items.length > 0) {
      await items[0].click();
      await page.waitForTimeout(3000);
    }

    // 5. 상품 클릭
    console.log("5. 상품 클릭...");
    for (let i = 0; i < 15; i++) {
      const link = await page.$(`a[href*="${TEST_PRODUCT.nvMid}"]`);
      if (link) {
        await link.click();
        break;
      }
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(5000);

    if (!capturedLog) {
      console.log("❌ product-logs 캡처 실패!");
      return;
    }

    console.log("\n캡처 완료:");
    console.log(`  product-logs URL: ${capturedLog.url}`);
    console.log(`  crd/rd URL: ${capturedCrdUrl?.substring(0, 80)}...`);

    // 6. 브라우저 내에서 100회 전송
    console.log(`\n=== ${TOTAL_REQUESTS}회 전송 시작 (브라우저 컨텍스트) ===\n`);

    const results: Array<{ round: number; ackey: string; crd: number; pl: number }> = [];
    let crdSuccess = 0;
    let plSuccess = 0;
    let bothSuccess = 0;

    for (let i = 1; i <= TOTAL_REQUESTS; i++) {
      const ackey = generateAckey();
      const time = Date.now();

      // 브라우저 내에서 crd/rd + product-logs 전송
      const result = await page.evaluate(
        async ({ ackey, time, capturedLog, testProduct }) => {
          const queryEncoded = testProduct.queryEncoded;
          const acqEncoded = testProduct.acqEncoded;

          // 1. crd/rd 전송
          const crdParams = new URLSearchParams({
            m: "1",
            px: "206",
            py: String(1200 + Math.floor(Math.random() * 300)),
            sx: "206",
            sy: "449",
            vw: "412",
            vh: "900",
            bw: "412",
            bh: "1784",
            q: testProduct.query,
            ie: "utf8",
            rev: "1",
            ssc: "tab.m.all",
            f: "m",
            w: "m",
            time: time.toString(),
            a: "shp_lis.out",
            u: `https://cr3.shopping.naver.com/v2/bridge/searchGate?nv_mid=${testProduct.nvMid}&cat_id=50004210&query=${queryEncoded}&frm=MOSCPRO`,
            r: "7",
            cr: "1"
          });

          const crdReferer = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${queryEncoded}&ackey=${ackey}&acq=${acqEncoded}&acr=5&qdt=0`;

          let crdStatus = 0;
          try {
            const crdRes = await fetch(`https://m.search.naver.com/p/crd/rd?${crdParams.toString()}`, {
              method: "POST",
              headers: {
                "accept": "*/*",
                "referer": crdReferer
              },
              credentials: "include"
            });
            crdStatus = crdRes.status;
          } catch {
            crdStatus = 0;
          }

          // 2. product-logs 전송
          const plReferer = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${queryEncoded}&ackey=${ackey}&acq=${acqEncoded}&acr=5&qdt=0`;

          const plBody = { ...capturedLog.body, referer: plReferer };

          let plStatus = 0;
          try {
            const plRes = await fetch(capturedLog.url, {
              method: "POST",
              headers: {
                "accept": "application/json",
                "content-type": "application/json",
                "useshopfegw": "true",
                "x-client-version": "20251215170000"
              },
              body: JSON.stringify(plBody),
              credentials: "include"
            });
            plStatus = plRes.status;
          } catch {
            plStatus = 0;
          }

          return { crdStatus, plStatus };
        },
        {
          ackey,
          time,
          capturedLog: { url: capturedLog.url, body: capturedLog.body },
          testProduct: TEST_PRODUCT
        }
      );

      results.push({
        round: i,
        ackey,
        crd: result.crdStatus,
        pl: result.plStatus
      });

      const crdOk = result.crdStatus >= 200 && result.crdStatus < 300;
      const plOk = result.plStatus >= 200 && result.plStatus < 300;

      if (crdOk) crdSuccess++;
      if (plOk) plSuccess++;
      if (crdOk && plOk) bothSuccess++;

      const crdIcon = crdOk ? "✅" : "❌";
      const plIcon = plOk ? "✅" : "❌";
      process.stdout.write(`\r[${i}/${TOTAL_REQUESTS}] crd:${crdIcon}(${result.crdStatus}) pl:${plIcon}(${result.plStatus}) ackey:${ackey}`);

      await page.waitForTimeout(100);
    }

    console.log("\n\n========================================");
    console.log("=== Test 5 결과 (브라우저 컨텍스트) ===");
    console.log("========================================\n");

    console.log(`crd/rd 성공: ${crdSuccess}/${TOTAL_REQUESTS} (${(crdSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);
    console.log(`product-logs 성공: ${plSuccess}/${TOTAL_REQUESTS} (${(plSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);
    console.log(`둘 다 성공: ${bothSuccess}/${TOTAL_REQUESTS} (${(bothSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);

    // 결과 저장
    const summary = {
      test: "Test 5: crd/rd + product-logs (browser context)",
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

    const filename = `scripts/ackey-test/results/test5_browser_${new Date().toISOString().split("T")[0]}.json`;
    fs.writeFileSync(filename, JSON.stringify(summary, null, 2), "utf-8");
    console.log(`\n결과 저장: ${filename}`);

  } finally {
    console.log("\n5초 후 브라우저 종료...");
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

runTest5BrowserContext();
