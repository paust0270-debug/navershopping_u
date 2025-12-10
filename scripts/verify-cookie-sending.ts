/**
 * Verify Cookie Sending via Browser Fetch
 *
 * 브라우저 내부 fetch로 쿠키가 실제로 전송되는지 확인
 */

import { chromium } from "patchright";

async function verifyCookieSending() {
  console.log("=== Cookie Sending Verification ===\n");

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

  // 먼저 네이버에 접속하여 쿠키 획득
  console.log("[1] Navigating to naver.com to get cookies...\n");
  await page.goto("https://www.naver.com", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

  // 브라우저 컨텍스트의 쿠키 확인
  const browserCookies = await context.cookies();
  console.log(`[Browser Context] Total cookies: ${browserCookies.length}`);

  const criticalCookies = ["NNB", "NACT", "NAC"];
  for (const name of criticalCookies) {
    const cookie = browserCookies.find(c => c.name === name);
    if (cookie) {
      console.log(`  ${name}: ${cookie.value.substring(0, 20)}... (domain: ${cookie.domain}, sameSite: ${cookie.sameSite})`);
    }
  }

  // 브라우저 내부에서 fetch를 실행하고 실제로 전송된 쿠키 확인
  console.log("\n[2] Testing cookie sending via browser fetch...\n");

  // httpbin.org를 사용하여 쿠키 전송 확인 (네이버 쿠키는 네이버 도메인에만 전송됨)
  // 대신 네이버의 API를 호출하여 응답 확인

  const testResult = await page.evaluate(async () => {
    const results: any[] = [];

    // Test 1: NAC API (credentials: include)
    try {
      const nacResponse = await fetch("https://nam.veta.naver.com/nac/1", {
        credentials: "include",
      });
      const nacText = await nacResponse.text();
      results.push({
        test: "NAC API (nam.veta.naver.com)",
        status: nacResponse.status,
        ok: nacResponse.ok,
        hasToken: nacText.length > 10,
        tokenPreview: nacText.substring(0, 50),
      });
    } catch (e: any) {
      results.push({
        test: "NAC API",
        error: e.message,
      });
    }

    // Test 2: Shopping API
    try {
      const shopResponse = await fetch("https://shopping.naver.com/api/modules", {
        credentials: "include",
      });
      results.push({
        test: "Shopping API",
        status: shopResponse.status,
        ok: shopResponse.ok,
      });
    } catch (e: any) {
      results.push({
        test: "Shopping API",
        error: e.message,
      });
    }

    // Test 3: document.cookie 확인
    results.push({
      test: "document.cookie",
      cookies: document.cookie.substring(0, 200),
      hasNNB: document.cookie.includes("NNB="),
      hasNACT: document.cookie.includes("NACT="),
    });

    return results;
  });

  console.log("Test Results:");
  for (const result of testResult) {
    console.log(`\n📋 ${result.test}:`);
    if (result.error) {
      console.log(`   ❌ Error: ${result.error}`);
    } else if (result.test === "document.cookie") {
      console.log(`   Cookies: ${result.cookies || "(empty)"}`);
      console.log(`   ├─ NNB: ${result.hasNNB ? "✅" : "❌"}`);
      console.log(`   └─ NACT: ${result.hasNACT ? "✅" : "❌"}`);
    } else {
      console.log(`   Status: ${result.status}`);
      console.log(`   OK: ${result.ok ? "✅" : "❌"}`);
      if (result.tokenPreview) {
        console.log(`   Token: ${result.tokenPreview}...`);
      }
    }
  }

  // NAC 토큰을 성공적으로 받으면 쿠키가 제대로 전송된 것
  const nacResult = testResult.find(r => r.test?.includes("NAC API"));
  console.log("\n" + "=".repeat(50));
  if (nacResult?.hasToken) {
    console.log("✅ PASS: Cookies are being sent correctly!");
    console.log("   NAC token received, which means cookies were included in request.");
  } else {
    console.log("❌ FAIL: Cookies may not be sent correctly");
    console.log("   NAC API did not return expected token.");
  }
  console.log("=".repeat(50));

  await browser.close();
  console.log("\n=== Verification Complete ===");
}

verifyCookieSending().catch(console.error);
