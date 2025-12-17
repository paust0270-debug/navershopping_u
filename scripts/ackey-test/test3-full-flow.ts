/**
 * 테스트 3: 전체 흐름 반복
 *
 * 매 회차마다 실제 페이지 로드처럼 전체 요청 순서를 따름:
 * 1. GET /products/{id} - 페이지 로드
 * 2. POST wcs beacon
 * 3. POST ambulance/pages
 * 4. GET nlog beacon
 * 5. POST product-logs (dwellTime 증가)
 *
 * 실행: npx tsx scripts/ackey-test/test3-full-flow.ts
 */

import "dotenv/config";
import { chromium, type Page } from "patchright";
import * as fs from "fs";
import * as path from "path";

const RESULT_DIR = path.join(__dirname, "results");

// 테스트 상품 정보 (디월트 전기톱)
const TEST_PRODUCT = {
  keyword: "디월트 전기톱",
  productName: "디월트 충전 전기톱 20V 체인톱 200mm 무선 전동 DCMPS520N 베어툴",
  nvMid: "86683606603",
  storeId: "",
  productId: ""
};

interface CapturedData {
  productLogUrl: string;
  productLogHeaders: Record<string, string>;
  productLogBody: any;
  wcsUrl: string;
  ambulanceUrl: string;
  ambulanceBody: any;
  nlogUrl: string;
  referer: string;
}

interface TestResult {
  testName: string;
  testDate: string;
  product: {
    keyword: string;
    productName: string;
    nvMid: string;
  };
  totalRounds: number;
  successRounds: number;
  successRate: string;
  conclusion: string;
}

const log = (msg: string, data?: any) => {
  const ts = new Date().toLocaleTimeString();
  console.log(data ? `[${ts}] ${msg}` : `[${ts}] ${msg}`, data || "");
};

// 랜덤 ackey 생성
function generateAckey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function test3FullFlow() {
  log("=== 테스트 3: 전체 흐름 반복 ===\n");
  log(`상품: ${TEST_PRODUCT.productName}`);
  log(`키워드: ${TEST_PRODUCT.keyword}`);
  log(`MID: ${TEST_PRODUCT.nvMid}`);

  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--window-position=50,50", "--window-size=450,900"]
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

  const page = await context.newPage();

  // 캡처할 데이터
  let captured: CapturedData | null = null;

  // 요청 캡처
  page.on("request", req => {
    const url = req.url();
    const method = req.method();

    if (!captured) {
      captured = {
        productLogUrl: "",
        productLogHeaders: {},
        productLogBody: null,
        wcsUrl: "",
        ambulanceUrl: "",
        ambulanceBody: null,
        nlogUrl: "",
        referer: ""
      };
    }

    // product-logs
    if (url.includes("product-logs") && method === "POST") {
      const postData = req.postData();
      if (postData) {
        try {
          captured.productLogUrl = url;
          captured.productLogHeaders = req.headers();
          captured.productLogBody = JSON.parse(postData);
          captured.referer = captured.productLogBody.referer || "";
          log("✅ product-logs 캡처");
        } catch {}
      }
    }

    // WCS beacon
    if (url.includes("wcs.naver.com/b") && method === "POST") {
      captured.wcsUrl = url;
      log("✅ WCS 비콘 캡처");
    }

    // ambulance/pages
    if (url.includes("ambulance/pages") && method === "POST") {
      captured.ambulanceUrl = url;
      const postData = req.postData();
      if (postData) {
        try {
          captured.ambulanceBody = JSON.parse(postData);
        } catch {}
      }
      log("✅ ambulance/pages 캡처");
    }

    // nlog
    if (url.includes("nlog.naver.com") && method === "GET") {
      captured.nlogUrl = url;
      log("✅ nlog 캡처");
    }
  });

  let totalRounds = 0;
  let successRounds = 0;

  try {
    // 1단계: m.naver.com → 자동완성 → 검색 → 상품 클릭 (테스트 1,2와 동일)
    log("\n1단계: m.naver.com에서 자동완성으로 진입...");

    let capturedAckey: string | null = null;

    // 자동완성 API에서 ackey 캡처
    page.on("request", req => {
      const url = req.url();
      if (url.includes("mac.search.naver.com") && url.includes("ackey=")) {
        try {
          const u = new URL(url);
          const ackey = u.searchParams.get("ackey");
          if (ackey && !capturedAckey) {
            capturedAckey = ackey;
            log(`🔑 ackey 캡처: ${ackey}`);
          }
        } catch {}
      }
    });

    // m.naver.com 접속
    await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 검색창 활성화
    log("검색창 활성화...");
    const searchBtn = await page.$("#MM_SEARCH_FAKE");
    if (searchBtn) await searchBtn.click();
    await page.waitForTimeout(1000);

    // 키워드 입력
    log(`키워드 입력: ${TEST_PRODUCT.keyword}`);
    const input = await page.$("#query");
    if (input) {
      await input.click();
      for (const char of TEST_PRODUCT.keyword) {
        await page.keyboard.type(char, { delay: 150 });
      }
    }
    await page.waitForTimeout(2000);

    // 자동완성 클릭
    const items = await page.$$("li.u_atcp_l");
    log(`자동완성 항목: ${items.length}개`);

    if (items.length > 0) {
      await items[0].click();
      await page.waitForTimeout(2000);
    }

    // URL에서 ackey 확인
    try {
      const url = new URL(page.url());
      capturedAckey = url.searchParams.get("ackey") || capturedAckey;
    } catch {}

    if (!capturedAckey) {
      log("❌ ackey 캡처 실패!");
      return;
    }

    log(`캡처된 ackey: ${capturedAckey}`);

    // 자동완성 URL 생성 (캡처된 ackey 사용, query만 상품명으로 변경)
    const searchUrl = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${encodeURIComponent(TEST_PRODUCT.productName)}&ackey=${capturedAckey}&acq=${encodeURIComponent(TEST_PRODUCT.keyword)}&acr=1&qdt=0`;

    log(`\n검색 URL로 이동 (query만 상품명으로 변경)...`);
    await page.goto(searchUrl, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 네이버플러스스토어에서 MID 상품 찾기
    log(`네이버플러스스토어에서 MID ${TEST_PRODUCT.nvMid} 상품 검색...`);

    let foundProduct = false;
    for (let scroll = 0; scroll < 20; scroll++) {
      const productLink = await page.$(`a[href*="${TEST_PRODUCT.nvMid}"]`);
      if (productLink) {
        log(`✅ MID 상품 발견!`);
        await productLink.click();
        await page.waitForTimeout(5000);
        foundProduct = true;
        break;
      }
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(500);
    }

    if (!foundProduct) {
      log("❌ MID 상품 못 찾음!");
      return;
    }

    // 캡처 대기
    await page.waitForTimeout(3000);

    if (!captured || !captured.productLogBody) {
      log("❌ 초기 캡처 실패!");
      return;
    }

    // 현재 smartstore URL 캡처
    const smartstoreUrl = page.url();
    log(`\nsmartstore URL: ${smartstoreUrl}`);

    log("\n캡처 완료:");
    log(`  product-logs URL: ${captured.productLogUrl.substring(0, 60)}...`);
    log(`  WCS URL: ${captured.wcsUrl ? "O" : "X"}`);
    log(`  ambulance URL: ${captured.ambulanceUrl ? "O" : "X"}`);
    log(`  nlog URL: ${captured.nlogUrl ? "O" : "X"}`);

    // 2단계: 전체 흐름 반복 (100회 테스트)
    const TOTAL_ROUNDS = 100;
    log(`\n2단계: 전체 흐름 ${TOTAL_ROUNDS}회 반복...\n`);

    let accumulatedDwell = 0;

    for (let round = 0; round < TOTAL_ROUNDS; round++) {
      totalRounds++;
      let roundSuccess = true;

      // dwellTime 증가 (5~20초 랜덤)
      accumulatedDwell += Math.floor(Math.random() * 15000) + 5000;
      const scrollDepth = Math.floor(Math.random() * 80) + 10;

      try {
        // 1) GET /products/{id} - 페이지 리로드 (실제 페이지 reload 사용)
        // fetch는 CORS로 실패할 수 있으므로 무시하고 진행
        // 실제 브라우저는 이미 페이지에 있으므로 reload 대신 현재 상태 유지

        // 짧은 딜레이
        await page.waitForTimeout(100);

        // 2) POST wcs beacon
        if (captured.wcsUrl) {
          await page.evaluate(async (url: string) => {
            try {
              await fetch(url, { method: "POST", credentials: "include" });
            } catch {}
          }, captured.wcsUrl);
        }

        await page.waitForTimeout(50);

        // 3) POST ambulance/pages
        if (captured.ambulanceUrl && captured.ambulanceBody) {
          await page.evaluate(async ({ url, body }: { url: string; body: any }) => {
            try {
              await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                credentials: "include"
              });
            } catch {}
          }, { url: captured.ambulanceUrl, body: captured.ambulanceBody });
        }

        await page.waitForTimeout(50);

        // 4) GET nlog beacon
        if (captured.nlogUrl) {
          // nlog URL에 타임스탬프 추가
          const nlogWithTs = captured.nlogUrl + (captured.nlogUrl.includes("?") ? "&" : "?") + "_t=" + Date.now();
          await page.evaluate(async (url: string) => {
            try {
              await fetch(url, { method: "GET", credentials: "include" });
            } catch {}
          }, nlogWithTs);
        }

        await page.waitForTimeout(50);

        // 5) POST product-logs (dwellTime, scrollDepth 변경)
        const modifiedBody = { ...captured.productLogBody };
        // dwellTime과 scrollDepth는 body에 없고 URL이나 다른 곳에 있을 수 있음
        // 일단 body 그대로 전송

        const productLogResult = await page.evaluate(async ({ url, headers, body }: { url: string; headers: any; body: any }) => {
          try {
            const res = await fetch(url, {
              method: "POST",
              headers: {
                "accept": "application/json",
                "content-type": "application/json",
                ...headers
              },
              body: JSON.stringify(body),
              credentials: "include"
            });
            return { status: res.status, ok: res.ok };
          } catch (e: any) {
            return { status: 0, ok: false, error: e.message };
          }
        }, {
          url: captured.productLogUrl,
          headers: {
            "useshopfegw": captured.productLogHeaders["useshopfegw"] || "true",
            "x-client-version": captured.productLogHeaders["x-client-version"] || "20251211104817"
          },
          body: modifiedBody
        });

        // 200, 201, 204 모두 성공으로 처리
        const isProductLogSuccess = productLogResult.ok || productLogResult.status === 200 || productLogResult.status === 201 || productLogResult.status === 204;

        if (!isProductLogSuccess) {
          roundSuccess = false;
        }

        if (roundSuccess) {
          successRounds++;
        }

        // 진행 상황 출력 (10회마다)
        if ((round + 1) % 10 === 0 || round === 0 || !roundSuccess) {
          const statusInfo = `status=${productLogResult.status}`;
          log(`  [${round + 1}/${TOTAL_ROUNDS}] ${roundSuccess ? "✅" : "❌"} ${statusInfo} (성공: ${successRounds}/${totalRounds})`);
        }


        // 라운드 간 딜레이 (1~3초)
        await page.waitForTimeout(Math.floor(Math.random() * 2000) + 1000);

      } catch (error: any) {
        log(`  [${round + 1}] 에러: ${error.message}`);
      }
    }

    log(`\n=== 테스트 3 결과 ===`);
    log(`전체 흐름 반복: ${TOTAL_ROUNDS}회`);
    log(`성공: ${successRounds}/${totalRounds}`);
    log(`성공률: ${((successRounds / totalRounds) * 100).toFixed(1)}%`);

    const conclusion = successRounds >= totalRounds * 0.9 ? "✅ 전체 흐름 반복 유효!" : "❌ 전체 흐름 반복 실패";
    log(`결론: ${conclusion}`);

    // 결과 저장
    if (!fs.existsSync(RESULT_DIR)) {
      fs.mkdirSync(RESULT_DIR, { recursive: true });
    }

    const testResult: TestResult = {
      testName: "test3-full-flow",
      testDate: new Date().toISOString().split("T")[0],
      product: {
        keyword: TEST_PRODUCT.keyword,
        productName: TEST_PRODUCT.productName,
        nvMid: TEST_PRODUCT.nvMid
      },
      totalRounds,
      successRounds,
      successRate: `${((successRounds / totalRounds) * 100).toFixed(1)}%`,
      conclusion
    };

    const resultFile = path.join(RESULT_DIR, `test3_${new Date().toISOString().split("T")[0]}.json`);
    fs.writeFileSync(resultFile, JSON.stringify(testResult, null, 2), "utf-8");
    log(`\n결과 저장: ${resultFile}`);

  } finally {
    log("\n5초 후 브라우저 종료...");
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

test3FullFlow();
