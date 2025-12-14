/**
 * 전체 상품 모니터링 스크립트
 * 각 상품별 일일 진행상황을 한 눈에 확인
 *
 * 사용법: npx tsx scripts/monitor-status.ts
 */

import * as fs from "fs";
import * as path from "path";

interface ProductStatus {
  name: string;
  mid: string;
  logDir: string;
  dailyTarget: number;
  schedule: string[];
}

const PRODUCTS: ProductStatus[] = [
  {
    name: "신지모루",
    mid: "89029512267",
    logDir: "logs/sinzimoru",
    dailyTarget: 2000,
    schedule: ["14:39", "16:05", "17:35", "19:05", "20:35", "22:05"],
  },
  {
    name: "차이팟",
    mid: "83539482665",
    logDir: "logs/chaipot",
    dailyTarget: 2000,
    schedule: ["14:42", "16:15", "17:45", "19:15", "20:45", "22:15"],
  },
  {
    name: "남자골덴바지",
    mid: "90173163527",
    logDir: "logs/goldenbanji",
    dailyTarget: 2000,
    schedule: ["14:40", "16:10", "17:40", "19:10", "20:40", "22:10"],
  },
];

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function parseLogFile(logPath: string): { runs: number; totalRequests: number; successRequests: number } {
  const result = { runs: 0, totalRequests: 0, successRequests: 0 };

  if (!fs.existsSync(logPath)) {
    return result;
  }

  const content = fs.readFileSync(logPath, "utf-8");
  const lines = content.split("\n");

  for (const line of lines) {
    // "완료: 340/340" 패턴 찾기
    const completeMatch = line.match(/완료:\s*(\d+)\/(\d+)/);
    if (completeMatch) {
      result.runs++;
      result.successRequests += parseInt(completeMatch[1]);
      result.totalRequests += parseInt(completeMatch[2]);
    }

    // "일일 누적: N회" 패턴 찾기 (최신 값 사용)
    const cumulativeMatch = line.match(/일일 누적:\s*(\d+)회/);
    if (cumulativeMatch) {
      result.totalRequests = Math.max(result.totalRequests, parseInt(cumulativeMatch[1]));
    }
  }

  return result;
}

function getProductStatus(product: ProductStatus): {
  runs: number;
  totalRequests: number;
  successRequests: number;
  progress: number;
  remainingSlots: number;
  estimatedTotal: number;
} {
  const today = getToday();
  const logPath = path.join(process.cwd(), product.logDir, `scheduler-${today}.log`);

  const stats = parseLogFile(logPath);

  // 현재 시간 기준 남은 슬롯 계산
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  let remainingSlots = 0;
  for (const slot of product.schedule) {
    const [hour, minute] = slot.split(":").map(Number);
    if (hour > currentHour || (hour === currentHour && minute > currentMinute)) {
      remainingSlots++;
    }
  }

  // 예상 최종 요청 수
  const estimatedTotal = stats.totalRequests + remainingSlots * 340;

  return {
    ...stats,
    progress: (stats.totalRequests / product.dailyTarget) * 100,
    remainingSlots,
    estimatedTotal,
  };
}

function printProgressBar(percent: number, width: number = 30): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

function printStatus() {
  const timestamp = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  console.log("\n");
  console.log("╔════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                    TURAFIC 모니터링 대시보드                                ║");
  console.log("╚════════════════════════════════════════════════════════════════════════════╝");
  console.log(`\n시간: ${timestamp}\n`);
  console.log("─".repeat(78));

  let totalAllProducts = 0;
  let targetAllProducts = 0;

  for (const product of PRODUCTS) {
    const status = getProductStatus(product);
    totalAllProducts += status.totalRequests;
    targetAllProducts += product.dailyTarget;

    const progressBar = printProgressBar(Math.min(status.progress, 100));
    const statusIcon = status.progress >= 100 ? "✅" : status.progress >= 50 ? "🔄" : "⏳";

    console.log(`\n${statusIcon} ${product.name} (MID: ${product.mid})`);
    console.log(`   ${progressBar} ${status.progress.toFixed(1)}%`);
    console.log(`   현재: ${status.totalRequests}회 / 목표: ${product.dailyTarget}회`);
    console.log(`   실행: ${status.runs}회 완료 | 남은 슬롯: ${status.remainingSlots}개`);
    console.log(`   예상 최종: ${status.estimatedTotal}회`);
    console.log(`   스케줄: ${product.schedule.join(", ")}`);
  }

  console.log("\n" + "─".repeat(78));

  const overallProgress = (totalAllProducts / targetAllProducts) * 100;
  console.log(`\n📊 전체 진행률: ${totalAllProducts}회 / ${targetAllProducts}회 (${overallProgress.toFixed(1)}%)`);
  console.log(`   ${printProgressBar(Math.min(overallProgress, 100), 50)}`);
  console.log("\n");
}

// 실시간 모드 (--watch)
if (process.argv.includes("--watch") || process.argv.includes("-w")) {
  console.clear();
  printStatus();

  setInterval(() => {
    console.clear();
    printStatus();
  }, 30000); // 30초마다 갱신
} else {
  printStatus();
}
