/**
 * 셔플 테스트: crd/rd + product-logs 함께 전송
 *
 * 브라우저로 셔플 검색 → 상품 클릭 → product-logs 캡처
 * → crd/rd + product-logs 100회 전송
 *
 * 실행: npx tsx scripts/shuffle-test-packet/test-crd-and-productlogs.ts
 */

import "dotenv/config";
import { chromium } from "patchright";
import { applyMobileStealth } from "../../shared/mobile-stealth";
import * as fs from "fs";
import * as path from "path";

const RESULT_DIR = path.join(__dirname, "results");

// 테스트 상품
const TEST_PRODUCT = {
  keyword: "베비샵 볼헤드",
  productName: "베비샵 카메라 볼헤드 조인트 볼마운트 조명 삼각대 셀카봉",
  nvMid: "83820860781",
  productId: "",  // 브라우저에서 캡처 시 자동 획득
  storeUrl: "",   // 브라우저에서 캡처 시 자동 획득
  categoryId: "", // 브라우저에서 캡처 시 자동 획득
};

const TOTAL_REQUESTS = 100;

interface TestResult {
  round: number;
  ackey: string;
  crd: { status: number; success: boolean };
  productLogs: { status: number; success: boolean };
  timestamp: number;
}

const log = (msg: string, data?: any) => {
  const ts = new Date().toLocaleTimeString();
  console.log(data ? `[${ts}] ${msg}` : `[${ts}] ${msg}`, data || "");
};

// Fisher-Yates 셔플
function shuffleWords(productName: string): string {
  const cleaned = productName
    .replace(/[\[\](){}]/g, " ")
    .replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= 1) return cleaned;
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words.join(" ");
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

// 랜덤 page_uid 생성
function generatePageUid(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 랜덤 session key 생성
function generateSessionKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// crd/rd 전송
async function sendCrdRd(params: {
  ackey: string;
  pageUid: string;
  sessionKey: string;
  time: number;
  queryEncoded: string;
  acqEncoded: string;
}): Promise<{ status: number; success: boolean }> {
  const { ackey, pageUid, sessionKey, time, queryEncoded, acqEncoded } = params;

  const crdParams = new URLSearchParams({
    m: "1",
    px: "206",
    py: "1340",
    sx: "206",
    sy: "449",
    vw: "412",
    vh: "900",
    bw: "412",
    bh: "1784",
    bx: "206",
    by: "1219",
    p: pageUid,
    q: TEST_PRODUCT.productName,
    ie: "utf8",
    rev: "1",
    ssc: "tab.m.all",
    f: "m",
    w: "m",
    s: sessionKey,
    time: time.toString(),
    abt: JSON.stringify([
      { eid: "PWL-EVADE-PAP", vid: "12" },
      { eid: "NCO-CARINS3", vid: "3" },
      { eid: "NEW-PLACE-SEARCH", vid: "8" },
      { eid: "NSHP-ORG-RANKING", vid: "21" }
    ]),
    a: "shp_lis.out",
    u: `https://cr3.shopping.naver.com/v2/bridge/searchGate?nv_mid=${TEST_PRODUCT.nvMid}&cat_id=${TEST_PRODUCT.categoryId}&query=${queryEncoded}&frm=MOSCPRO`,
    r: "7",
    i: "00000009_00132f745e52",
    cr: "1"
  });

  const crdUrl = `https://m.search.naver.com/p/crd/rd?${crdParams.toString()}`;
  const referer = `https://m.search.naver.com/search.naver?sm=mtp_hty.top&where=m&query=${queryEncoded}&ackey=${ackey}&acq=${acqEncoded}&acr=5&qdt=0`;

  try {
    const response = await fetch(crdUrl, {
      method: "POST",
      headers: {
        "accept": "*/*",
        "origin": "https://m.search.naver.com",
        "referer": referer,
        "user-agent": "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": "\"Android\""
      }
    });

    return { status: response.status, success: response.ok };
  } catch {
    return { status: 0, success: false };
  }
}

// product-logs 전송
async function sendProductLogs(params: {
  ackey: string;
  pageUid: string;
  queryEncoded: string;
  acqEncoded: string;
  capturedBody: any;
}): Promise<{ status: number; success: boolean }> {
  const { ackey, pageUid, queryEncoded, acqEncoded, capturedBody } = params;

  const referer = `https://m.search.naver.com/search.naver?sm=mtp_hty.top&where=m&query=${queryEncoded}&ackey=${ackey}&acq=${acqEncoded}&acr=5&qdt=0`;

  const body = {
    ...capturedBody,
    referer: referer
  };

  const pageReferer = `https://m.smartstore.naver.com/${TEST_PRODUCT.storeUrl}/products/${TEST_PRODUCT.productId}?nl-query=${queryEncoded}&nl-ts-pid=${pageUid}`;

  try {
    const response = await fetch(
      `https://m.smartstore.naver.com/i/v1/product-logs/${TEST_PRODUCT.productId}`,
      {
        method: "POST",
        headers: {
          "accept": "application/json",
          "content-type": "application/json",
          "origin": "https://m.smartstore.naver.com",
          "referer": pageReferer,
          "user-agent": "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
          "useshopfegw": "true",
          "x-client-version": "20251218150000"
        },
        body: JSON.stringify(body)
      }
    );

    return { status: response.status, success: response.ok };
  } catch {
    return { status: 0, success: false };
  }
}

async function runTest() {
  log("=== 셔플 테스트: crd/rd + product-logs 함께 전송 ===\n");

  const shuffledKeyword = shuffleWords(TEST_PRODUCT.productName);
  log(`원본: ${TEST_PRODUCT.productName}`);
  log(`셔플: ${shuffledKeyword}`);
  log(`MID: ${TEST_PRODUCT.nvMid}\n`);

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
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });

  // 모바일 스텔스 스크립트 적용
  await applyMobileStealth(context);

  const page = await context.newPage();

  let capturedLog: any = null;
  let capturedAckey: string | null = null;

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
          log("product-logs 캡처!");

          try {
            const refUrl = new URL(capturedLog.referer);
            capturedAckey = refUrl.searchParams.get("ackey");
          } catch {}
        } catch {}
      }
    }
  });

  try {
    // 1. m.naver.com 접속
    log("1. m.naver.com 접속...");
    await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. 검색창 클릭
    log("2. 검색창 클릭...");
    const searchInput = await page.$('input[name="query"]') || await page.$("#query");
    if (!searchInput) {
      throw new Error("검색창 못 찾음");
    }
    await searchInput.click();
    await page.waitForTimeout(500);

    // 3. 셔플된 키워드 입력
    log(`3. 셔플 키워드 입력: ${shuffledKeyword.substring(0, 30)}...`);
    for (const char of shuffledKeyword) {
      await page.keyboard.type(char, { delay: 50 + Math.random() * 50 });
    }
    await page.waitForTimeout(1500);

    // 4. 엔터로 검색
    log("4. 엔터로 검색...");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    // ackey 캡처
    const currentUrl = page.url();
    try {
      const urlObj = new URL(currentUrl);
      capturedAckey = urlObj.searchParams.get("ackey");
      log(`  ackey: ${capturedAckey || "(없음)"}`);
      log(`  sm: ${urlObj.searchParams.get("sm")}`);
    } catch {}

    // 5. 원본 상품명으로 재검색
    log("5. 원본 상품명으로 재검색...");
    const urlObj = new URL(currentUrl);
    urlObj.searchParams.set("query", TEST_PRODUCT.productName);
    await page.goto(urlObj.toString(), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // 6. MID 상품 찾기
    log(`6. MID ${TEST_PRODUCT.nvMid} 상품 찾기...`);
    let found = false;
    for (let scroll = 0; scroll < 10; scroll++) {
      const productLink = await page.$(`a[href*="${TEST_PRODUCT.nvMid}"]`);
      if (productLink) {
        log("  상품 발견! 클릭...");
        await productLink.click();
        await page.waitForTimeout(3000);
        found = true;
        break;
      }
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(500);
    }

    if (!found) {
      throw new Error("MID 상품 못 찾음");
    }

    // 7. product-logs 캡처 대기
    if (!capturedLog) {
      log("product-logs 대기중...");
      await page.waitForTimeout(3000);
    }

    if (!capturedLog) {
      throw new Error("product-logs 캡처 실패");
    }

    log("\n캡처된 referer 분석:");
    try {
      const refUrl = new URL(capturedLog.referer);
      log(`  sm: ${refUrl.searchParams.get("sm")}`);
      log(`  ackey: ${refUrl.searchParams.get("ackey")}`);
    } catch {}

    // 8. crd/rd + product-logs 100회 전송
    log(`\ncrd/rd + product-logs ${TOTAL_REQUESTS}회 전송 시작...`);

    const queryEncoded = encodeURIComponent(TEST_PRODUCT.productName);
    const acqEncoded = encodeURIComponent(TEST_PRODUCT.keyword);

    const results: TestResult[] = [];
    let crdSuccess = 0;
    let productLogsSuccess = 0;
    let bothSuccess = 0;

    for (let i = 1; i <= TOTAL_REQUESTS; i++) {
      const ackey = generateAckey();
      const pageUid = generatePageUid();
      const sessionKey = generateSessionKey();
      const time = Date.now();

      // 1. crd/rd 전송
      const crdResult = await sendCrdRd({ ackey, pageUid, sessionKey, time, queryEncoded, acqEncoded });

      await new Promise(r => setTimeout(r, 100));

      // 2. product-logs 전송
      const productLogsResult = await sendProductLogs({
        ackey,
        pageUid,
        queryEncoded,
        acqEncoded,
        capturedBody: capturedLog.body
      });

      const result: TestResult = {
        round: i,
        ackey,
        crd: crdResult,
        productLogs: productLogsResult,
        timestamp: time
      };

      results.push(result);

      if (crdResult.success) crdSuccess++;
      if (productLogsResult.success) productLogsSuccess++;
      if (crdResult.success && productLogsResult.success) bothSuccess++;

      const crdStatus = crdResult.success ? "O" : "X";
      const plStatus = productLogsResult.success ? "O" : "X";
      process.stdout.write(`\r[${i}/${TOTAL_REQUESTS}] crd:${crdStatus}(${crdResult.status}) pl:${plStatus}(${productLogsResult.status})`);

      await new Promise(r => setTimeout(r, 200));
    }

    console.log("\n");
    log("=== 결과 ===");
    log(`셔플 키워드: ${shuffledKeyword.substring(0, 30)}...`);
    log(`crd/rd 성공: ${crdSuccess}/${TOTAL_REQUESTS} (${(crdSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);
    log(`product-logs 성공: ${productLogsSuccess}/${TOTAL_REQUESTS} (${(productLogsSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);
    log(`둘 다 성공: ${bothSuccess}/${TOTAL_REQUESTS} (${(bothSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);

    // 결과 저장
    if (!fs.existsSync(RESULT_DIR)) {
      fs.mkdirSync(RESULT_DIR, { recursive: true });
    }

    const summary = {
      testName: "shuffle-crd-and-productlogs",
      testDate: new Date().toISOString(),
      shuffledKeyword,
      originalKeyword: TEST_PRODUCT.productName,
      product: TEST_PRODUCT,
      totalRequests: TOTAL_REQUESTS,
      apiType: "crd-and-productlogs",
      results: {
        crd: {
          success: crdSuccess,
          fail: TOTAL_REQUESTS - crdSuccess,
          rate: (crdSuccess / TOTAL_REQUESTS * 100).toFixed(1) + "%"
        },
        productLogs: {
          success: productLogsSuccess,
          fail: TOTAL_REQUESTS - productLogsSuccess,
          rate: (productLogsSuccess / TOTAL_REQUESTS * 100).toFixed(1) + "%"
        },
        both: {
          success: bothSuccess,
          fail: TOTAL_REQUESTS - bothSuccess,
          rate: (bothSuccess / TOTAL_REQUESTS * 100).toFixed(1) + "%"
        }
      },
      details: results
    };

    const resultFile = path.join(RESULT_DIR, `shuffle_crd_productlogs_${new Date().toISOString().split("T")[0]}.json`);
    fs.writeFileSync(resultFile, JSON.stringify(summary, null, 2), "utf-8");
    log(`\n결과 저장: ${resultFile}`);

  } catch (error: any) {
    log(`에러: ${error.message}`);
  } finally {
    log("\n5초 후 브라우저 종료...");
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

runTest();
