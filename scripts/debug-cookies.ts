/**
 * Cookie Domain Debug Script
 *
 * 쿠키 domain 설정이 올바른지 확인
 */

import { chromium } from "patchright";

async function debugCookies() {
  console.log("=== Cookie Domain Debug ===\n");

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

  console.log("[1] Navigating to naver.com...\n");
  await page.goto("https://www.naver.com", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  // 쿠키 정보 상세 출력
  const cookies = await context.cookies();

  console.log("[2] All cookies from browser context:\n");
  console.log("=" .repeat(100));
  console.log("| Name".padEnd(20) + "| Domain".padEnd(25) + "| Path".padEnd(10) + "| SameSite".padEnd(12) + "| Secure | HttpOnly |");
  console.log("=" .repeat(100));

  for (const cookie of cookies) {
    console.log(
      "| " + cookie.name.padEnd(18) +
      "| " + cookie.domain.padEnd(23) +
      "| " + cookie.path.padEnd(8) +
      "| " + (cookie.sameSite || "None").padEnd(10) +
      "| " + (cookie.secure ? "Yes" : "No").padEnd(7) +
      "| " + (cookie.httpOnly ? "Yes" : "No").padEnd(9) + "|"
    );
  }
  console.log("=" .repeat(100));

  // 특정 쿠키 확인
  const criticalCookies = ["NNB", "NACT", "NAC", "nx_ssl", "PM_CK_loc"];
  console.log("\n[3] Critical cookies domain check:\n");

  for (const name of criticalCookies) {
    const cookie = cookies.find(c => c.name === name);
    if (cookie) {
      console.log(`  ${name}:`);
      console.log(`    - domain: "${cookie.domain}"`);
      console.log(`    - path: "${cookie.path}"`);
      console.log(`    - sameSite: "${cookie.sameSite || "None"}"`);
      console.log(`    - secure: ${cookie.secure}`);
      console.log(`    - Will be sent to siape.veta.naver.com? ${cookie.domain === ".naver.com" ? "YES ✅" : "NO ❌ (domain should be .naver.com)"}`);
    } else {
      console.log(`  ${name}: NOT FOUND ❌`);
    }
  }

  // 실제 요청에서 쿠키가 어떻게 전송되는지 확인
  console.log("\n[4] Testing actual request to siape.veta.naver.com...\n");

  // Request listener 설정
  page.on("request", (request) => {
    if (request.url().includes("siape.veta.naver.com")) {
      const headers = request.headers();
      console.log(`  Request to: ${request.url().substring(0, 80)}...`);
      console.log(`  Cookie header: ${headers["cookie"]?.substring(0, 100) || "EMPTY"}...`);
      console.log("");
    }
  });

  // shopping.naver.com으로 이동하여 siape 요청 트리거
  console.log("  Navigating to shopping.naver.com to trigger siape requests...\n");
  await page.goto("https://shopping.naver.com", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(5000);

  // CDP로 쿠키 확인
  console.log("\n[5] Cookies via CDP (Chrome DevTools Protocol):\n");

  const cdpSession = await context.newCDPSession(page);
  const { cookies: cdpCookies } = await cdpSession.send("Network.getAllCookies");

  const naverCookies = cdpCookies.filter((c: any) => c.domain.includes("naver.com"));
  console.log(`  Found ${naverCookies.length} naver.com cookies via CDP`);

  for (const cookie of naverCookies.slice(0, 10)) {
    console.log(`    - ${cookie.name}: domain="${cookie.domain}", sameSite="${cookie.sameSite}"`);
  }

  await browser.close();
  console.log("\n=== Debug Complete ===");
}

debugCookies().catch(console.error);
