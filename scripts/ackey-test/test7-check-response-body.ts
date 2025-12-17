/**
 * 테스트 7: 응답 본문 검증
 *
 * 목적: HTTP 200이 진짜 성공인지 응답 본문까지 확인
 *
 * 검증 항목:
 * 1. product-logs 응답 본문에 에러 메시지가 있는지
 * 2. 정상 요청 vs 랜덤 page_uid 요청의 응답 차이
 * 3. 400/401/403 등 실패 케이스가 있는지
 *
 * 실행: npx tsx scripts/ackey-test/test7-check-response-body.ts
 */

import "dotenv/config";
import { chromium } from "patchright";
import { applyMobileStealth } from "../../shared/mobile-stealth";
import * as fs from "fs";
import * as path from "path";

const RESULT_DIR = path.join(__dirname, "results");

// 테스트 상품 정보
const TEST_PRODUCT = {
  keyword: "베비샵 카드수납",
  productName: "베비샵 Linkvu 카드수납 코튼 컬러 카메라렌즈보호 소프트 범퍼케이스",
  nvMid: "83896421438",
};

// page_uid 랜덤 생성
function generatePageUid(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let front = "";
  for (let i = 0; i < 19; i++) {
    front += chars[Math.floor(Math.random() * chars.length)];
  }
  const seq = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  return `${front}-${seq}`;
}

// 랜덤 ackey 생성
function generateAckey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const log = (msg: string, data?: any) => {
  const ts = new Date().toLocaleTimeString();
  console.log(data ? `[${ts}] ${msg}` : `[${ts}] ${msg}`, data || "");
};

async function test7CheckResponseBody() {
  log("=== 테스트 7: 응답 본문 검증 ===\n");
  log(`상품: ${TEST_PRODUCT.productName}`);
  log(`MID: ${TEST_PRODUCT.nvMid}`);

  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--window-position=50,50", "--window-size=500,900"]
  });

  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    userAgent: "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });

  // 모바일 스텔스 스크립트 적용
  await applyMobileStealth(context);

  const page = await context.newPage();

  let capturedLog: any = null;

  page.on("request", (req) => {
    if (req.url().includes("product-logs") && req.method() === "POST") {
      const postData = req.postData();
      if (postData) {
        try {
          const body = JSON.parse(postData);
          capturedLog = {
            url: req.url(),
            headers: req.headers(),
            body,
            referer: body.referer || ""
          };
          log("✅ product-logs 캡처!");
        } catch {}
      }
    }
  });

  const results: any[] = [];

  try {
    // 1단계: 정상 진입으로 product-logs 캡처
    log("\n1단계: 정상 진입으로 캡처...");
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

    // 엔터로 검색
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    // 상품명으로 재검색
    const productSearchUrl = `https://m.search.naver.com/search.naver?query=${encodeURIComponent(TEST_PRODUCT.productName)}&sm=mtp_sug.top`;
    await page.goto(productSearchUrl, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // MID 상품 찾기
    let foundProduct = false;
    for (let scroll = 0; scroll < 15; scroll++) {
      const productLink = await page.$(`a[href*="nv_mid=${TEST_PRODUCT.nvMid}"]`);
      if (productLink) {
        log(`✅ MID 상품 발견!`);
        await productLink.click();
        await page.waitForTimeout(3000);
        foundProduct = true;
        break;
      }
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(500);
    }

    if (!foundProduct || !capturedLog) {
      log("❌ 상품을 찾을 수 없거나 캡처 실패!");
      await browser.close();
      return;
    }

    // 원본 referer 저장
    const originalReferer = capturedLog.referer;
    log(`\n원본 referer: ${originalReferer.substring(0, 80)}...`);

    // 2단계: 다양한 케이스 테스트 (응답 본문 확인)
    log("\n2단계: 응답 본문 검증 테스트...");

    const testCases = [
      { name: "원본 (변경 없음)", pageUid: null, ackey: null },
      { name: "랜덤 page_uid", pageUid: generatePageUid(), ackey: null },
      { name: "랜덤 ackey", pageUid: null, ackey: generateAckey() },
      { name: "둘 다 랜덤", pageUid: generatePageUid(), ackey: generateAckey() },
      { name: "잘못된 형식 page_uid", pageUid: "INVALID-123", ackey: null },
      { name: "빈 page_uid", pageUid: "", ackey: null },
    ];

    for (const testCase of testCases) {
      log(`\n--- 케이스: ${testCase.name} ---`);

      // referer 수정
      let modifiedReferer = originalReferer;
      try {
        const refUrl = new URL(originalReferer);
        if (testCase.pageUid !== null) {
          refUrl.searchParams.set("p", testCase.pageUid);
        }
        if (testCase.ackey !== null) {
          refUrl.searchParams.set("ackey", testCase.ackey);
        }
        modifiedReferer = refUrl.toString();
      } catch {}

      const modifiedBody = {
        ...capturedLog.body,
        referer: modifiedReferer,
        dwellTime: 5000 + Math.floor(Math.random() * 10000),
        scrollDepth: 30 + Math.floor(Math.random() * 50),
        timestamp: Date.now(),
        eventTime: Date.now(),
      };

      // 응답 본문까지 가져오기
      const response = await page.evaluate(
        async ({ url, headers, body }) => {
          try {
            const cleanHeaders: Record<string, string> = {};
            for (const [key, value] of Object.entries(headers)) {
              const lowerKey = key.toLowerCase();
              if (lowerKey !== "content-length" && lowerKey !== "host") {
                cleanHeaders[key] = value as string;
              }
            }
            cleanHeaders["content-type"] = "application/json";

            const res = await fetch(url, {
              method: "POST",
              headers: cleanHeaders,
              body: JSON.stringify(body),
              credentials: "include" as RequestCredentials,
            });

            // 응답 본문 읽기
            let responseBody = null;
            try {
              const text = await res.text();
              try {
                responseBody = JSON.parse(text);
              } catch {
                responseBody = text;
              }
            } catch {}

            return {
              status: res.status,
              statusText: res.statusText,
              ok: res.ok,
              headers: Object.fromEntries(res.headers.entries()),
              body: responseBody,
            };
          } catch (e: any) {
            return { error: e.message };
          }
        },
        {
          url: capturedLog.url,
          headers: capturedLog.headers,
          body: modifiedBody,
        }
      );

      log(`  상태: ${response.status} ${response.statusText}`);
      log(`  OK: ${response.ok}`);
      log(`  응답 본문: ${JSON.stringify(response.body)}`);

      results.push({
        case: testCase.name,
        pageUid: testCase.pageUid,
        ackey: testCase.ackey,
        status: response.status,
        ok: response.ok,
        responseBody: response.body,
        error: response.error,
      });

      await page.waitForTimeout(500);
    }

    // 3단계: 결과 분석
    log("\n" + "=".repeat(60));
    log("=== 테스트 결과 요약 ===");
    log("=".repeat(60));

    for (const r of results) {
      const statusIcon = r.ok ? "✅" : "❌";
      log(`${statusIcon} ${r.case}: ${r.status} | body=${JSON.stringify(r.responseBody)?.substring(0, 50)}`);
    }

    // 결론 도출
    const allSuccess = results.every(r => r.ok);
    const allSameBody = results.every(r => JSON.stringify(r.responseBody) === JSON.stringify(results[0].responseBody));

    log("\n=== 결론 ===");
    if (allSuccess && allSameBody) {
      log("✅ 모든 케이스 HTTP 200, 응답 동일 → page_uid/ackey 서버 검증 없음");
    } else if (allSuccess && !allSameBody) {
      log("⚠️ 모든 케이스 HTTP 200이지만 응답이 다름 → 응답 내용 분석 필요");
    } else {
      log("❌ 일부 케이스 실패 → 서버에서 검증함");
    }

    // 결과 저장
    if (!fs.existsSync(RESULT_DIR)) {
      fs.mkdirSync(RESULT_DIR, { recursive: true });
    }

    const resultFile = path.join(RESULT_DIR, `test7_${new Date().toISOString().split("T")[0]}.json`);
    fs.writeFileSync(resultFile, JSON.stringify({
      testName: "test7-response-body-check",
      testDate: new Date().toISOString(),
      product: TEST_PRODUCT,
      results,
      conclusion: allSuccess ? "서버 검증 없음" : "서버 검증 있음",
    }, null, 2), "utf-8");
    log(`\n결과 저장: ${resultFile}`);

  } finally {
    log("\n5초 후 브라우저 종료...");
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

test7CheckResponseBody().catch(console.error);
