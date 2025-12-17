/**
 * smartstore 진입 시 요청 순서 분석
 *
 * product-logs POST 전에 어떤 GET 요청이 먼저 가는지 확인
 */

import { chromium } from "patchright";

interface RequestLog {
  idx: number;
  method: string;
  url: string;
  type: string;
  timestamp: number;
}

async function analyzeRequestFlow() {
  console.log("=== smartstore 진입 시 요청 순서 분석 ===\n");

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

  const allRequests: RequestLog[] = [];
  const startTime = Date.now();

  // 모든 요청 캡처 (POST는 전부, GET은 smartstore만)
  page.on("request", req => {
    const url = req.url();
    const method = req.method();

    // POST 요청은 전부 캡처
    if (method === "POST") {
      allRequests.push({
        idx: allRequests.length,
        method,
        url,
        type: req.resourceType(),
        timestamp: Date.now() - startTime
      });
      console.log(`[REQ] ${method} ${url.substring(0, 80)}`);
    }
    // GET은 smartstore, nlog, wcs만
    else if (
      url.includes("smartstore") ||
      url.includes("nlog") ||
      url.includes("wcs.naver")
    ) {
      allRequests.push({
        idx: allRequests.length,
        method,
        url,
        type: req.resourceType(),
        timestamp: Date.now() - startTime
      });
    }
  });

  // 검색 referer
  const referer = "https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=%ED%94%84%EB%A6%AC%EB%AF%B8%EC%97%84&ackey=test1234&acq=%EC%B0%A8%EC%9D%B4%ED%8C%9F&acr=1&qdt=0";

  console.log("smartstore 접근 시작...");
  console.log("referer:", referer.substring(0, 80) + "...\n");

  await page.goto("https://m.smartstore.naver.com/sunsaem/products/5994983177", {
    waitUntil: "networkidle",
    timeout: 30000,
    referer
  });

  await page.waitForTimeout(8000);  // 충분히 대기

  console.log("=== 캡처된 요청 순서 ===\n");

  // product-logs 인덱스 찾기
  const productLogIdx = allRequests.findIndex(r => r.url.includes("product-logs"));

  allRequests.forEach((r, i) => {
    let label = "";
    let urlShort = r.url;

    if (r.url.includes("product-logs")) {
      label = ">>> PRODUCT-LOGS";
      urlShort = "";
    } else if (r.url.includes("/i/v1/")) {
      label = "[API]";
      urlShort = r.url.split("smartstore.naver.com")[1]?.split("?")[0] || "";
    } else if (r.url.includes("smartstore.naver.com") && r.type === "document") {
      label = "[PAGE]";
      urlShort = r.url.split("smartstore.naver.com")[1]?.substring(0, 50) || "";
    } else if (r.url.includes("nlog")) {
      label = "[NLOG]";
      urlShort = "";
    } else if (r.url.includes("wcs")) {
      label = "[WCS]";
      urlShort = "";
    } else {
      label = "[" + r.type.toUpperCase() + "]";
      urlShort = r.url.substring(0, 50);
    }

    const marker = i === productLogIdx ? ">>>" : "   ";
    console.log(`${marker} [${r.idx}] +${r.timestamp}ms ${r.method.padEnd(5)} ${label.padEnd(15)} ${urlShort}`);
  });

  // product-logs 상세
  console.log("\n=== product-logs 전에 발생하는 주요 요청 ===\n");

  const beforeProductLog = allRequests.slice(0, productLogIdx);
  const pageRequest = beforeProductLog.find(r => r.type === "document");
  const apiRequests = beforeProductLog.filter(r => r.url.includes("/i/v1/"));

  console.log("1. 페이지 GET:", pageRequest ? "O" : "X");
  if (pageRequest) {
    console.log("   URL:", pageRequest.url.substring(0, 100));
  }

  console.log("\n2. API 요청들:");
  apiRequests.forEach(r => {
    const path = r.url.split("smartstore.naver.com")[1]?.split("?")[0];
    console.log("   -", r.method, path);
  });

  console.log("\n3. NLOG 비콘:", beforeProductLog.filter(r => r.url.includes("nlog")).length + "개");
  console.log("4. WCS 비콘:", beforeProductLog.filter(r => r.url.includes("wcs")).length + "개");

  await page.waitForTimeout(3000);
  await browser.close();
  console.log("\n완료");
}

analyzeRequestFlow();
