/**
 * TLS & Cookie Debug via CDP
 *
 * CDP를 사용하여 실제 HTTP/2 여부와 쿠키 전송 확인
 */

import { chromium } from "patchright";

async function debugTLSandCookies() {
  console.log("=== TLS & Cookie Debug via CDP ===\n");

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

  // Network 이벤트 활성화
  await cdp.send("Network.enable");

  // 요청/응답 프로토콜 추적
  const requestProtocols: Map<string, string> = new Map();
  const requestCookies: Map<string, string> = new Map();

  cdp.on("Network.requestWillBeSent", (params) => {
    const url = params.request.url;
    if (url.includes("naver.com")) {
      const cookies = params.request.headers["Cookie"] || params.request.headers["cookie"] || "";
      requestCookies.set(params.requestId, cookies);
    }
  });

  cdp.on("Network.responseReceived", (params) => {
    const url = params.response.url;
    const protocol = params.response.protocol;

    if (url.includes("naver.com")) {
      requestProtocols.set(url.substring(0, 60), protocol);

      // siape 요청의 쿠키 확인
      if (url.includes("siape.veta.naver.com")) {
        const cookies = requestCookies.get(params.requestId) || "NONE";
        console.log(`[CDP] siape request:`);
        console.log(`  URL: ${url.substring(0, 80)}...`);
        console.log(`  Protocol: ${protocol}`);
        console.log(`  Cookies: ${cookies.substring(0, 100)}${cookies.length > 100 ? "..." : ""}`);
        console.log("");
      }
    }
  });

  console.log("[1] Navigating to naver.com...\n");
  await page.goto("https://www.naver.com", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

  console.log("\n[2] Protocol summary (HTTP/1.1 vs HTTP/2):\n");

  const protocolCount = {
    "h2": 0,
    "http/1.1": 0,
    "other": 0,
  };

  for (const [url, protocol] of requestProtocols) {
    if (protocol === "h2") {
      protocolCount["h2"]++;
    } else if (protocol === "http/1.1") {
      protocolCount["http/1.1"]++;
    } else {
      protocolCount["other"]++;
    }
  }

  console.log(`  HTTP/2 (h2): ${protocolCount["h2"]} requests`);
  console.log(`  HTTP/1.1: ${protocolCount["http/1.1"]} requests`);
  console.log(`  Other: ${protocolCount["other"]} requests`);

  // 프로토콜별 샘플 URL 출력
  console.log("\n[3] Sample URLs by protocol:\n");

  let h2Count = 0;
  let http11Count = 0;

  for (const [url, protocol] of requestProtocols) {
    if (protocol === "h2" && h2Count < 3) {
      console.log(`  [h2] ${url}`);
      h2Count++;
    }
    if (protocol === "http/1.1" && http11Count < 3) {
      console.log(`  [http/1.1] ${url}`);
      http11Count++;
    }
  }

  // TLS 정보 확인 (tls.peet.ws)
  console.log("\n[4] TLS fingerprint check via browser fetch...\n");

  const tlsResult = await page.evaluate(async () => {
    try {
      const response = await fetch("https://tls.peet.ws/api/all");
      return await response.json();
    } catch (e: any) {
      return { error: e.message };
    }
  });

  if (tlsResult.error) {
    console.log(`  Error: ${tlsResult.error}`);
  } else {
    console.log(`  TLS Version: ${tlsResult.tls?.version || "N/A"}`);
    console.log(`  Cipher Suite: ${tlsResult.tls?.cipher || "N/A"}`);
    console.log(`  HTTP Version: ${tlsResult.http_version || "N/A"}`);
    console.log(`  JA3: ${tlsResult.ja3 || "N/A (TLS 1.3에서는 없을 수 있음)"}`);
    console.log(`  JA3 Hash: ${tlsResult.ja3_hash || "N/A"}`);
    console.log(`  JA4: ${tlsResult.ja4 || "N/A"}`);
    console.log(`  ALPN: ${tlsResult.tls?.alpn || "N/A"}`);

    // Chrome 특성 확인
    if (tlsResult.user_agent) {
      console.log(`  User-Agent: ${tlsResult.user_agent.substring(0, 80)}...`);
    }
  }

  // shopping.naver.com으로 이동하여 siape 요청 확인
  console.log("\n[5] Navigating to shopping.naver.com to capture siape requests...\n");

  requestProtocols.clear();
  requestCookies.clear();

  await page.goto("https://shopping.naver.com", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(5000);

  // 스크롤하여 추가 요청 트리거
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(2000);

  console.log("\n[6] Final protocol summary for shopping.naver.com:\n");

  const finalProtocolCount = {
    "h2": 0,
    "http/1.1": 0,
    "other": 0,
  };

  for (const [_, protocol] of requestProtocols) {
    if (protocol === "h2") {
      finalProtocolCount["h2"]++;
    } else if (protocol === "http/1.1") {
      finalProtocolCount["http/1.1"]++;
    } else {
      finalProtocolCount["other"]++;
    }
  }

  console.log(`  HTTP/2 (h2): ${finalProtocolCount["h2"]} requests`);
  console.log(`  HTTP/1.1: ${finalProtocolCount["http/1.1"]} requests`);

  if (finalProtocolCount["h2"] > finalProtocolCount["http/1.1"]) {
    console.log("\n  ✅ HTTP/2 is working correctly!");
  } else {
    console.log("\n  ⚠️  Most requests are HTTP/1.1 - check TLS configuration");
  }

  await browser.close();
  console.log("\n=== Debug Complete ===");
}

debugTLSandCookies().catch(console.error);
