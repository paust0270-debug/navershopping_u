/**
 * Test 5 (수정): crd/rd + product-logs 함께 전송 (세션 포함)
 *
 * 1. 브라우저로 상품 페이지 접속하여 쿠키/세션 획득
 * 2. 획득한 세션으로 crd/rd + product-logs 100회 전송
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

interface CapturedSession {
  cookies: string;
  pageUid: string;
  sessionKey: string;
  userAgent: string;
}

interface TestResult {
  round: number;
  ackey: string;
  crd: { status: number; success: boolean };
  productLogs: { status: number; success: boolean };
}

function generateAckey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function captureSession(): Promise<CapturedSession> {
  console.log("=== 세션 캡처 중... ===\n");

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

  let capturedCookies = "";
  let capturedPageUid = "";
  let capturedSessionKey = "";

  // 요청에서 쿠키 캡처
  page.on("request", req => {
    const url = req.url();
    if (url.includes("product-logs")) {
      const headers = req.headers();
      capturedCookies = headers.cookie || "";

      // page_uid 추출
      const pageUidMatch = capturedCookies.match(/page_uid=([^;]+)/);
      if (pageUidMatch) capturedPageUid = pageUidMatch[1];

      // session key 추출
      const sessionMatch = capturedCookies.match(/_naver_usersession_=([^;]+)/);
      if (sessionMatch) capturedSessionKey = sessionMatch[1];
    }
  });

  try {
    // 1. m.naver.com
    console.log("1. m.naver.com 접속...");
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

    // 쿠키 수집
    const cookies = await ctx.cookies();
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join("; ");

    console.log("\n✅ 세션 캡처 완료");
    console.log(`  쿠키 수: ${cookies.length}`);
    console.log(`  page_uid: ${capturedPageUid}`);
    console.log(`  session_key: ${capturedSessionKey?.substring(0, 20)}...`);

    await browser.close();

    return {
      cookies: cookieStr,
      pageUid: capturedPageUid,
      sessionKey: capturedSessionKey,
      userAgent: "Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    };

  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function sendCrdRd(session: CapturedSession, ackey: string, time: number): Promise<{ status: number; success: boolean }> {
  const referer = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${TEST_PRODUCT.queryEncoded}&ackey=${ackey}&acq=${TEST_PRODUCT.acqEncoded}&acr=5&qdt=0`;

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
    p: session.pageUid,
    q: TEST_PRODUCT.query,
    ie: "utf8",
    rev: "1",
    ssc: "tab.m.all",
    f: "m",
    w: "m",
    s: session.sessionKey,
    time: time.toString(),
    abt: JSON.stringify([
      { eid: "PWL-EVADE-PAP", vid: "12" },
      { eid: "NSHP-ORG-RANKING", vid: "21" }
    ]),
    a: "shp_lis.out",
    u: `https://cr3.shopping.naver.com/v2/bridge/searchGate?nv_mid=${TEST_PRODUCT.nvMid}&cat_id=50004210&query=${TEST_PRODUCT.queryEncoded}&frm=MOSCPRO`,
    r: "7",
    i: "00000009_00132f745e52",
    cr: "1"
  });

  try {
    const response = await fetch(`https://m.search.naver.com/p/crd/rd?${crdParams.toString()}`, {
      method: "POST",
      headers: {
        "accept": "*/*",
        "cookie": session.cookies,
        "origin": "https://m.search.naver.com",
        "referer": referer,
        "user-agent": session.userAgent
      }
    });
    return { status: response.status, success: response.ok };
  } catch {
    return { status: 0, success: false };
  }
}

async function sendProductLogs(session: CapturedSession, ackey: string): Promise<{ status: number; success: boolean }> {
  const referer = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${TEST_PRODUCT.queryEncoded}&ackey=${ackey}&acq=${TEST_PRODUCT.acqEncoded}&acr=5&qdt=0`;

  const body = {
    id: TEST_PRODUCT.productId,
    channel: {
      accountNo: 100425708,
      channelNo: "100469114",
      channelUid: "2sWDy5uNvjYrer3SMDoBT",
      channelName: "새똥이꿀복이",
      representName: "효성사",
      channelSiteUrl: TEST_PRODUCT.storeUrl,
      channelSiteFullUrl: `https://smartstore.naver.com/${TEST_PRODUCT.storeUrl}`,
      channelSiteMobileUrl: `https://m.smartstore.naver.com/${TEST_PRODUCT.storeUrl}`,
      accountId: "ncp_1nsgz0_01",
      naverPaySellerNo: "510435604",
      sellerExternalStatusType: "NORMAL",
      channelTypeCode: "STOREFARM"
    },
    channelServiceType: "STOREFARM",
    category: {
      categoryId: "50004210",
      categoryName: "로봇",
      wholeCategoryId: "50000005>50000142>50001154>50004210",
      wholeCategoryName: "출산/육아>완구/인형>작동완구>로봇",
      categoryLevel: 4
    },
    groupId: null,
    tr: "sls",
    planNo: "",
    referer: referer
  };

  const pageReferer = `https://m.smartstore.naver.com/${TEST_PRODUCT.storeUrl}/products/${TEST_PRODUCT.productId}?nl-query=${TEST_PRODUCT.queryEncoded}&nl-ts-pid=${session.pageUid}`;

  try {
    const response = await fetch(
      `https://m.smartstore.naver.com/i/v1/product-logs/${TEST_PRODUCT.productId}`,
      {
        method: "POST",
        headers: {
          "accept": "application/json",
          "content-type": "application/json",
          "cookie": session.cookies,
          "origin": "https://m.smartstore.naver.com",
          "referer": pageReferer,
          "user-agent": session.userAgent,
          "useshopfegw": "true",
          "x-client-version": "20251215160000"
        },
        body: JSON.stringify(body)
      }
    );
    return { status: response.status, success: response.ok };
  } catch {
    return { status: 0, success: false };
  }
}

async function runTest5WithSession() {
  console.log("=== Test 5: crd/rd + product-logs (세션 포함) ===\n");

  // 1. 세션 캡처
  const session = await captureSession();

  console.log(`\n=== ${TOTAL_REQUESTS}회 전송 시작 ===\n`);

  const results: TestResult[] = [];
  let crdSuccess = 0;
  let productLogsSuccess = 0;
  let bothSuccess = 0;

  for (let i = 1; i <= TOTAL_REQUESTS; i++) {
    const ackey = generateAckey();
    const time = Date.now();

    // crd/rd 전송
    const crdResult = await sendCrdRd(session, ackey, time);
    await new Promise(r => setTimeout(r, 50));

    // product-logs 전송
    const plResult = await sendProductLogs(session, ackey);

    results.push({ round: i, ackey, crd: crdResult, productLogs: plResult });

    if (crdResult.success) crdSuccess++;
    if (plResult.success) productLogsSuccess++;
    if (crdResult.success && plResult.success) bothSuccess++;

    const crdIcon = crdResult.success ? "✅" : "❌";
    const plIcon = plResult.success ? "✅" : "❌";
    process.stdout.write(`\r[${i}/${TOTAL_REQUESTS}] crd:${crdIcon}(${crdResult.status}) pl:${plIcon}(${plResult.status}) ackey:${ackey}`);

    await new Promise(r => setTimeout(r, 150));
  }

  console.log("\n\n========================================");
  console.log("=== Test 5 결과 (세션 포함) ===");
  console.log("========================================\n");

  console.log(`crd/rd 성공: ${crdSuccess}/${TOTAL_REQUESTS} (${(crdSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);
  console.log(`product-logs 성공: ${productLogsSuccess}/${TOTAL_REQUESTS} (${(productLogsSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);
  console.log(`둘 다 성공: ${bothSuccess}/${TOTAL_REQUESTS} (${(bothSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);

  // 저장
  const summary = {
    test: "Test 5: crd/rd + product-logs (with session)",
    product: TEST_PRODUCT,
    totalRequests: TOTAL_REQUESTS,
    results: {
      crd: { success: crdSuccess, rate: `${(crdSuccess/TOTAL_REQUESTS*100).toFixed(1)}%` },
      productLogs: { success: productLogsSuccess, rate: `${(productLogsSuccess/TOTAL_REQUESTS*100).toFixed(1)}%` },
      both: { success: bothSuccess, rate: `${(bothSuccess/TOTAL_REQUESTS*100).toFixed(1)}%` }
    },
    timestamp: new Date().toISOString(),
    details: results
  };

  const filename = `scripts/ackey-test/results/test5_session_${new Date().toISOString().split("T")[0]}.json`;
  fs.writeFileSync(filename, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\n결과 저장: ${filename}`);
}

runTest5WithSession();
