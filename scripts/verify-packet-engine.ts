/**
 * Packet Engine Verification Script
 *
 * 실행: npx tsx scripts/verify-packet-engine.ts
 *
 * 검증 항목:
 * 1. TLS Fingerprint (JA3/JA4, ALPN, Cipher)
 * 2. 네이버 로그 API 발생 여부
 * 3. 세션 쿠키 체인 연속성
 * 4. 전체 상품 플로우 테스트
 */

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { RealWorldTestRunner } from "../engines-packet/verification/RealWorldTestRunner.js";

async function main() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║           PACKET ENGINE VERIFICATION SUITE                    ║");
  console.log("║                                                               ║");
  console.log("║  This will test if the packet engine can:                     ║");
  console.log("║  1. Use Chrome TLS fingerprint (not Node.js TLS)              ║");
  console.log("║  2. Trigger Naver's required log APIs                         ║");
  console.log("║  3. Maintain cookie chain across requests                     ║");
  console.log("║  4. Complete a product search flow without CAPTCHA            ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  const runner = new RealWorldTestRunner((msg) => console.log(msg));

  try {
    // 테스트 상품 (옵션)
    const testProduct = {
      product_name: "테스트 상품",
      keyword: "아이폰 케이스",
      mid: "12345678901",
      mall_name: "테스트몰",
    };

    console.log("Starting verification tests...\n");
    console.log("⏳ This may take 1-2 minutes...\n");

    const report = await runner.runFullTest(testProduct);

    // 결과 출력
    runner.printFullReport(report);

    // 요약 JSON 저장
    const reportPath = `./logs/verification-${Date.now()}.json`;
    fs.mkdirSync("./logs", { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Full report saved to: ${reportPath}`);

    // 종료 코드
    if (report.overallSuccess) {
      console.log("\n✅ All verification tests passed!");
      console.log("   → Packet engine is ready for production testing\n");
      process.exit(0);
    } else {
      console.log("\n❌ Some verification tests failed!");
      console.log("   → Review the report above and fix issues before deployment\n");

      // Critical issues 다시 강조
      if (report.criticalIssues.length > 0) {
        console.log("🚨 CRITICAL ISSUES TO FIX:");
        report.criticalIssues.forEach((issue, i) => {
          console.log(`   ${i + 1}. ${issue}`);
        });
        console.log();
      }

      process.exit(1);
    }
  } catch (error: any) {
    console.error("\n❌ Verification failed with error:", error.message);
    process.exit(1);
  } finally {
    await runner.cleanup();
  }
}

// 실행
main();
