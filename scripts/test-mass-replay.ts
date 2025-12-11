/**
 * Mass Replay Test - 대량 요청 테스트
 *
 * 사용법:
 *   npx tsx scripts/test-mass-replay.ts
 *
 * 환경변수:
 *   PROXY_LIST=http://user:pass@host:port,http://...
 */

import { MassReplayEngine, loadProxiesFromEnv, type ReplayTask } from "../engines-packet/mass-replay";

// ============================================================
//  설정
// ============================================================

const TEST_CONFIG = {
  // 테스트 작업 수
  taskCount: 100,

  // 동시성 (프록시 없으면 낮게)
  concurrency: 10,

  // 속도 제한
  maxRequestsPerSecond: 5,

  // 타이밍
  minDelayMs: 500,
  maxDelayMs: 2000,
  dwellTimeRange: [3000, 8000] as [number, number],

  // 테스트할 상품들
  products: [
    { productId: "6103200734", merchantId: "511331240", channelNo: "101404649", categoryId: "50000982" },
    { productId: "6184640806", merchantId: "511331240", channelNo: "101404649", categoryId: "50000982" },
    // 더 많은 상품 추가 가능
  ],
};

// ============================================================
//  작업 생성
// ============================================================

function generateTasks(count: number): ReplayTask[] {
  const tasks: ReplayTask[] = [];
  const keywords = ["발매트", "카페트", "러그", "인테리어 매트", "현관 매트"];

  for (let i = 0; i < count; i++) {
    const product = TEST_CONFIG.products[i % TEST_CONFIG.products.length];
    const keyword = keywords[Math.floor(Math.random() * keywords.length)];

    tasks.push({
      ...product,
      searchKeyword: keyword,
      referer: `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}`,
    });
  }

  return tasks;
}

// ============================================================
//  메인 실행
// ============================================================

async function main() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║               Mass Replay Engine Test                          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  // 프록시 로드
  const proxies = loadProxiesFromEnv();
  console.log(`\n📡 Loaded ${proxies.length} proxies from environment`);

  if (proxies.length === 0) {
    console.log("⚠️  No proxies configured. Running without proxy rotation.");
    console.log("   Set PROXY_LIST env variable for proxy support.");
    console.log("   Format: http://user:pass@host:port,http://...\n");
  }

  // 작업 생성
  const tasks = generateTasks(TEST_CONFIG.taskCount);
  console.log(`📋 Generated ${tasks.length} tasks\n`);

  // 엔진 생성
  const engine = new MassReplayEngine({
    concurrency: TEST_CONFIG.concurrency,
    maxRequestsPerSecond: TEST_CONFIG.maxRequestsPerSecond,
    proxyPool: proxies,
    rotateProxyEvery: 3,
    minDelayMs: TEST_CONFIG.minDelayMs,
    maxDelayMs: TEST_CONFIG.maxDelayMs,
    dwellTimeRange: TEST_CONFIG.dwellTimeRange,
    maxRetries: 2,
  });

  // 실행
  console.log("🚀 Starting mass replay...\n");
  const startTime = Date.now();

  try {
    const results = await engine.execute(tasks);

    // 결과 분석
    const successResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);

    console.log("\n" + "─".repeat(70));
    console.log("📊 Detailed Results:");
    console.log("─".repeat(70));

    // 성공률 by 상품
    const byProduct = new Map<string, { success: number; failed: number }>();
    for (const r of results) {
      const stats = byProduct.get(r.productId) || { success: 0, failed: 0 };
      if (r.success) stats.success++;
      else stats.failed++;
      byProduct.set(r.productId, stats);
    }

    console.log("\n  By Product:");
    for (const [productId, stats] of byProduct) {
      const rate = ((stats.success / (stats.success + stats.failed)) * 100).toFixed(1);
      console.log(`    ${productId}: ${stats.success}/${stats.success + stats.failed} (${rate}%)`);
    }

    // 에러 분석
    if (failedResults.length > 0) {
      console.log("\n  Errors:");
      const errorCounts = new Map<string, number>();
      for (const r of failedResults) {
        const err = r.error || "Unknown error";
        errorCounts.set(err, (errorCounts.get(err) || 0) + 1);
      }
      for (const [err, count] of errorCounts) {
        console.log(`    ${err}: ${count}`);
      }
    }

    // 평균 응답 시간
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    console.log(`\n  Avg Duration: ${(avgDuration / 1000).toFixed(2)}s`);

    // 결과 저장
    const fs = await import("fs");
    const logFile = `logs/mass-replay-${Date.now()}.json`;
    fs.mkdirSync("logs", { recursive: true });
    fs.writeFileSync(logFile, JSON.stringify({
      config: TEST_CONFIG,
      stats: engine.getStats(),
      results: results.slice(0, 100),  // 처음 100개만 저장
    }, null, 2));
    console.log(`\n📁 Results saved to: ${logFile}`);

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n⏱️  Total time: ${elapsed.toFixed(1)}s`);
}

main().catch(console.error);
