/**
 * Debug Main Page Cookie Sending
 *
 * 메인 페이지 요청에서 쿠키가 실제로 전송되는지 확인
 */

import { chromium } from "patchright";

async function debugMainCookies() {
  console.log("=== Main Page Cookie Debug ===\n");

  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });

  const page = await context.newPage();

  // Anti-detection
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  // CDP 세션 시작
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");

  // 메인 도메인 요청만 추적
  const mainDomains = [
    "www.naver.com",
    "shopping.naver.com",
    "search.naver.com",
    "search.shopping.naver.com",
    "smartstore.naver.com",
  ];

  console.log("Tracking cookie sending for main domains:\n");

  cdp.on("Network.requestWillBeSent", (params) => {
    const url = params.request.url;
    const hostname = new URL(url).hostname;

    // 메인 도메인만 체크
    if (mainDomains.some(d => hostname.includes(d))) {
      const cookies = params.request.headers["Cookie"] || params.request.headers["cookie"] || "";
      const method = params.request.method;

      // document 요청만 (HTML 페이지)
      if (params.type === "Document" || url.endsWith("/") || !url.includes(".")) {
        console.log(`📄 ${method} ${url.substring(0, 70)}...`);
        console.log(`   Type: ${params.type || "unknown"}`);

        if (cookies) {
          // 중요 쿠키 확인
          const hasNNB = cookies.includes("NNB=");
          const hasNACT = cookies.includes("NACT=");
          const hasNAC = cookies.includes("NAC=");

          console.log(`   Cookies: ${cookies.length > 100 ? cookies.substring(0, 100) + "..." : cookies}`);
          console.log(`   ├─ NNB: ${hasNNB ? "✅" : "❌"}`);
          console.log(`   ├─ NACT: ${hasNACT ? "✅" : "❌"}`);
          console.log(`   └─ NAC: ${hasNAC ? "✅" : "❌"}`);
        } else {
          console.log(`   Cookies: ❌ NONE`);
        }
        console.log("");
      }
    }
  });

  console.log("[1] Navigating to naver.com...\n");
  await page.goto("https://www.naver.com", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

  // 쿠키 상태 확인
  const cookies = await context.cookies();
  console.log(`\n[Browser Context] Total cookies: ${cookies.length}`);

  const criticalCookies = ["NNB", "NACT", "NAC"];
  for (const name of criticalCookies) {
    const cookie = cookies.find(c => c.name === name);
    if (cookie) {
      console.log(`  ${name}: ${cookie.value.substring(0, 20)}... (domain: ${cookie.domain})`);
    } else {
      console.log(`  ${name}: NOT SET`);
    }
  }

  console.log("\n[2] Navigating to shopping.naver.com...\n");
  await page.goto("https://shopping.naver.com", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

  console.log("\n[3] Navigating to search.shopping.naver.com...\n");
  await page.goto("https://search.shopping.naver.com/search/all?query=test", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(2000);

  await browser.close();
  console.log("\n=== Debug Complete ===");
}

debugMainCookies().catch(console.error);
