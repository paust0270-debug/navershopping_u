/**
 * Product Log Replay 테스트
 *
 * 상품 조회수 증가 핵심 기능 테스트
 * - 상품 페이지 진입 → product-logs API 캡처
 * - 캡처된 템플릿으로 다중 리플레이
 *
 * 사용법:
 *   npx tsx scripts/test-productlog-replay.ts "베비샵 강아지발매트" "83647700222" 10
 *   (마지막 숫자는 리플레이 횟수)
 */

import { PacketEngine } from "../engines-packet";
import type { Product, RunContext } from "../engines-packet/types";
import { MultiSendEngine } from "../engines-packet/replay/MultiSendEngine";
import { BehaviorLogBuilder } from "../engines-packet/builders/BehaviorLogBuilder";

async function testProductLogReplay() {
  const keyword = process.argv[2] || "베비샵 강아지발매트";
  const mid = process.argv[3] || "83647700222";
  const replayCount = parseInt(process.argv[4] || "10");

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║           PRODUCT LOG REPLAY TEST                              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`\nKeyword: ${keyword}`);
  console.log(`MID: ${mid}`);
  console.log(`Replay Count: ${replayCount}\n`);

  // 테스트 상품 설정
  const testProduct: Product = {
    product_name: keyword,
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
    headless: false,
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

    // 엔진 실행 (상품 페이지까지 진입)
    const result = await engine.run(testProduct, ctx);

    console.log("\n" + "=".repeat(60));
    console.log("PHASE 1: BROWSE RESULT");
    console.log("=".repeat(60));
    console.log(`Success: ${result.success ? "✅ YES" : "❌ NO"}`);
    console.log(`Product Page Entered: ${result.productPageEntered ? "✅ YES" : "❌ NO"}`);
    console.log(`CAPTCHA: ${result.captchaDetected ? "❌ YES" : "✅ NO"}`);

    if (!result.success || !result.productPageEntered) {
      console.log("\n❌ 상품 페이지 진입 실패 - 리플레이 불가");
      return;
    }

    // ProductLogBuilder 가져오기
    const hybridContext = engine.getHybridContext();
    const productLogBuilder = hybridContext.getProductLogBuilder();

    if (!productLogBuilder) {
      console.log("\n❌ ProductLog 캡처 실패 - product-logs API가 캡처되지 않음");

      // 디버그: 캡처된 로그 확인
      const captor = hybridContext.getBehaviorLogCaptor();
      const logs = captor.getCapturedLogs();
      console.log(`\n캡처된 로그 수: ${logs.length}`);
      console.log("캡처된 URL들:");
      logs.slice(0, 10).forEach(l => {
        console.log(`  - ${l.url.substring(0, 60)}...`);
      });
      return;
    }

    console.log(`\n✅ ProductLog 템플릿 캡처 완료: 상품 ID ${productLogBuilder.getProductId()}`);

    // MultiSendEngine 설정
    const builder = new BehaviorLogBuilder(console.log);
    const multiSend = new MultiSendEngine(builder, console.log);
    multiSend.setPage(hybridContext.getPage()!);

    console.log("\n" + "=".repeat(60));
    console.log(`PHASE 2: REPLAYING ${replayCount} PRODUCT LOGS`);
    console.log("=".repeat(60));

    const replayStartTime = Date.now();

    // Product Log 리플레이
    const replayResult = await multiSend.sendProductLogs(
      productLogBuilder,
      replayCount,
      {
        minDelay: 100,   // 100ms 최소 딜레이
        maxDelay: 300,   // 300ms 최대 딜레이
        jitterPercent: 20,
        failFast: false, // 실패해도 계속
      }
    );

    const replayDuration = Date.now() - replayStartTime;

    console.log("\n" + "=".repeat(60));
    console.log("REPLAY RESULT");
    console.log("=".repeat(60));
    console.log(`Total: ${replayResult.total}`);
    console.log(`Success: ${replayResult.success} ✅`);
    console.log(`Failed: ${replayResult.failed} ${replayResult.failed > 0 ? "❌" : ""}`);
    console.log(`Duration: ${replayDuration}ms`);
    console.log(`Avg per request: ${Math.round(replayDuration / replayCount)}ms`);

    if (replayResult.errors.length > 0) {
      console.log(`\nFirst 5 errors:`);
      replayResult.errors.slice(0, 5).forEach(e => console.log(`  - ${e}`));
    }

    // 성공률 계산
    const successRate = (replayResult.success / replayResult.total * 100).toFixed(1);
    console.log(`\n📊 Success Rate: ${successRate}%`);

    if (replayResult.success > 0) {
      console.log("\n" + "=".repeat(60));
      console.log("🎉 REPLAY SUCCESS!");
      console.log("=".repeat(60));
      console.log(`${replayResult.success}개의 product-logs 요청이 성공적으로 전송됨`);
      console.log(`이론적으로 상품 조회수가 ${replayResult.success}회 증가해야 함`);
    }

    // 대기 (브라우저 확인용)
    console.log("\n[Test] 브라우저 확인을 위해 10초 대기...");
    await new Promise(r => setTimeout(r, 10000));

  } catch (error: any) {
    console.error(`\n❌ Test failed: ${error.message}`);
  } finally {
    await engine.cleanup();
    console.log("\n[Test] Cleanup complete");
  }
}

testProductLogReplay().catch(console.error);
