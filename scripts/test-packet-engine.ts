/**
 * Packet Engine 실제 테스트
 *
 * 사용법:
 *   npx tsx scripts/test-packet-engine.ts
 *   npx tsx scripts/test-packet-engine.ts "아이폰 케이스"
 */

import { PacketEngine } from "../engines-packet";
import type { Product, RunContext } from "../engines-packet/types";

async function testPacketEngine() {
  const keyword = process.argv[2] || "베비샵 강아지발매트";
  const mid = process.argv[3] || "83647700222";

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║              PACKET ENGINE TEST                                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`\nKeyword: ${keyword}`);
  console.log(`MID: ${mid}\n`);

  // 테스트 상품 설정
  const testProduct: Product = {
    product_name: "베비샵 강아지발매트",
    keyword: keyword,
    mid: mid,
    mall_name: "베비샵",
  };

  // 실행 컨텍스트
  const ctx: RunContext = {
    launchId: `test-${Date.now()}`,
    productIndex: 0,
    totalProducts: 1,
    startTime: Date.now(),
    retryCount: 0,
    maxRetries: 2,
    log: (event: string, data?: any) => {
      console.log(`[CTX] ${event}`, data ? JSON.stringify(data) : "");
    },
  };

  // 패킷 엔진 생성
  const engine = new PacketEngine({
    headless: false,  // GUI 모드
    logNetwork: true,
    replayConfig: {
      preserveTiming: true,
      timingMultiplier: 1.0,
    },
    hybridConfig: {
      captchaSolverEnabled: true,
    },
  }, console.log);

  try {
    console.log("[Test] Starting packet engine...\n");

    // 엔진 실행
    const result = await engine.run(testProduct, ctx);

    console.log("\n" + "=".repeat(60));
    console.log("TEST RESULT:");
    console.log("=".repeat(60));
    console.log(`Success: ${result.success ? "✅ YES" : "❌ NO"}`);
    console.log(`Duration: ${result.duration}ms`);
    console.log(`CAPTCHA Detected: ${result.captchaDetected ? "❌ YES" : "✅ NO"}`);
    console.log(`MID Matched: ${result.midMatched ? "✅ YES" : "❌ NO"}`);
    console.log(`Product Page Entered: ${result.productPageEntered ? "✅ YES" : "❌ NO"}`);
    console.log(`Session Valid: ${result.sessionValid ? "✅ YES" : "❌ NO"}`);
    console.log(`Request Count: ${result.requestCount}`);
    console.log(`Replay Duration: ${result.replayDuration}ms`);

    if (result.phases) {
      console.log("\nPhases:");
      for (const phase of result.phases) {
        console.log(`  - ${phase.phase}: ${phase.success ? "✅" : "❌"} (${phase.duration}ms)`);
        if (phase.error) {
          console.log(`    Error: ${phase.error}`);
        }
      }
    }

    if (result.error) {
      console.log(`\nError: ${result.error}`);
    }

    console.log("=".repeat(60));

    // 캡처된 행동 로그 확인
    const captor = engine.getHybridContext().getBehaviorLogCaptor();
    const capturedLogs = captor.getCapturedLogs();
    const stats = captor.getStats();

    console.log("\n" + "=".repeat(60));
    console.log("CAPTURED BEHAVIOR LOGS:");
    console.log("=".repeat(60));
    console.log(`Total captured: ${capturedLogs.length}`);
    console.log(`Stats:`, stats);

    if (capturedLogs.length > 0) {
      // 캡처 로그를 파일로 저장
      const fs = await import("fs");
      const logFile = `logs/captured-logs-${Date.now()}.json`;
      fs.mkdirSync("logs", { recursive: true });
      fs.writeFileSync(logFile, JSON.stringify(capturedLogs, null, 2));
      console.log(`\n📁 Captured logs saved to: ${logFile}`);

      // 중요 로그 타입별로 첫 번째 body 출력
      console.log("\n=== SAMPLE BODIES ===");
      const seenTypes = new Set<string>();
      for (const log of capturedLogs) {
        if (!seenTypes.has(log.type) && Object.keys(log.body).length > 0) {
          seenTypes.add(log.type);
          console.log(`\n[${log.type}] ${log.url.substring(0, 60)}...`);
          console.log(`Method: ${log.method}`);
          console.log(`Body: ${JSON.stringify(log.body).substring(0, 200)}...`);
        }
      }

      // 템플릿 확인
      const templates = captor.getAllTemplates();
      console.log(`\nTemplates created: ${templates.size}`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("📋 다음 단계: logs/ 폴더의 JSON 파일을 분석해서 API 형식 확인");
    console.log("=".repeat(60));

  } catch (error: any) {
    console.error(`\n❌ Test failed: ${error.message}`);
  } finally {
    await engine.cleanup();
    console.log("\n[Test] Cleanup complete");
  }
}

testPacketEngine().catch(console.error);
