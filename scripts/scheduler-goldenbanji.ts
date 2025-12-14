/**
 * 남자골덴바지 전용 스케줄러
 * MID: 90173163527
 * 키워드: 남자골덴바지
 *
 * 오늘(12/13) 목표: 2000~2100회
 * 남은 시간: ~9시간 (14:30 ~ 24:00)
 * 전략: 6회 × 340회 = 2040회
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

const PRODUCT = {
  name: "남자골덴바지",
  mid: "90173163527",
  keyword: "남자 코듀로이 팬츠 겨울 헤비 골덴 와이드 밴딩 스판 빅사이즈",
  mall: "",
};

// 키워드 수정 후 테스트 (14:50 시작)
const CONFIG = {
  customSchedule: [
    { hour: 14, minute: 50 },   // 키워드 수정 후 테스트
    { hour: 16, minute: 10 },
    { hour: 17, minute: 40 },
    { hour: 19, minute: 10 },
    { hour: 20, minute: 40 },
    { hour: 22, minute: 10 },
  ],
  baseCount: 340,  // 340 × 6 = 2040회
  variance: 10,
  scriptPath: path.join(__dirname, "mass-rotation-runner.ts"),
  logDir: path.join(__dirname, "..", "logs", "goldenbanji"),
};

// 로그 디렉토리 생성
if (!fs.existsSync(CONFIG.logDir)) {
  fs.mkdirSync(CONFIG.logDir, { recursive: true });
}

// 일일 통계
let dailyStats = {
  date: new Date().toISOString().split("T")[0],
  totalRequests: 0,
  successRequests: 0,
  failedRequests: 0,
  runs: 0,
};

function log(message: string) {
  const timestamp = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const logMessage = `[${timestamp}] [${PRODUCT.name}] ${message}`;
  console.log(logMessage);
  const logFile = path.join(CONFIG.logDir, `scheduler-${dailyStats.date}.log`);
  fs.appendFileSync(logFile, logMessage + "\n");
}

function getRandomCount(): number {
  const min = CONFIG.baseCount - CONFIG.variance;
  const max = CONFIG.baseCount + CONFIG.variance;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getNextScheduledTime(): { time: Date; index: number } {
  const now = new Date();
  const today = new Date(now);

  for (let i = 0; i < CONFIG.customSchedule.length; i++) {
    const slot = CONFIG.customSchedule[i];
    const scheduledTime = new Date(today);
    scheduledTime.setHours(slot.hour, slot.minute, 0, 0);
    if (scheduledTime > now) {
      return { time: scheduledTime, index: i };
    }
  }

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(CONFIG.customSchedule[0].hour, CONFIG.customSchedule[0].minute, 0, 0);
  return { time: tomorrow, index: 0 };
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

async function runMassRotation(count: number): Promise<void> {
  return new Promise((resolve) => {
    log(`실행 시작: ${count}회 요청`);
    const startTime = Date.now();
    const outputFile = path.join(CONFIG.logDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
    const outputStream = fs.createWriteStream(outputFile);

    // Windows shell 문제 해결: 전체 명령어를 문자열로 구성하여 shell에 전달
    const cmdLine = `npx tsx "${CONFIG.scriptPath}" --count ${count} --mid ${PRODUCT.mid} --keyword "${PRODUCT.keyword}"`;

    const child = spawn(cmdLine, [], {
      cwd: path.join(__dirname, ".."),
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    child.stdout?.on("data", (data) => {
      const text = data.toString();
      output += text;
      outputStream.write(text);
      if (text.includes("Progress:") || text.includes("SUMMARY")) {
        process.stdout.write(text);
      }
    });

    child.stderr?.on("data", (data) => {
      outputStream.write(data.toString());
    });

    child.on("close", (code) => {
      outputStream.end();
      const duration = Date.now() - startTime;
      dailyStats.runs++;

      if (code === 0) {
        const successMatch = output.match(/Success:\s*(\d+)/);
        const failedMatch = output.match(/Failed:\s*(\d+)/);
        const success = successMatch ? parseInt(successMatch[1]) : count;
        const failed = failedMatch ? parseInt(failedMatch[1]) : 0;

        dailyStats.totalRequests += count;
        dailyStats.successRequests += success;
        dailyStats.failedRequests += failed;

        log(`완료: ${success}/${count} (${formatDuration(duration)}) | 일일 누적: ${dailyStats.totalRequests}회`);
      } else {
        log(`실패: exit code ${code}`);
      }
      resolve();
    });
  });
}

async function scheduleNext() {
  // 날짜 변경 체크
  const today = new Date().toISOString().split("T")[0];
  if (today !== dailyStats.date) {
    log(`=== 일일 리셋 === 전일 총: ${dailyStats.totalRequests}회`);
    dailyStats = { date: today, totalRequests: 0, successRequests: 0, failedRequests: 0, runs: 0 };
  }

  const { time: nextTime, index } = getNextScheduledTime();
  const delay = nextTime.getTime() - Date.now();

  log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log(`다음 실행: ${nextTime.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);
  log(`대기: ${formatDuration(delay)} | 슬롯: ${index + 1}/${CONFIG.customSchedule.length}`);
  log(`일일 누적: ${dailyStats.totalRequests}회 (${dailyStats.runs}회 실행)`);
  log(`목표: 2000~2100회 | 남은 예상: ${(CONFIG.customSchedule.length - dailyStats.runs) * CONFIG.baseCount}회`);
  log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  setTimeout(async () => {
    const count = getRandomCount();
    await runMassRotation(count);
    scheduleNext();
  }, delay);
}

function printHeader() {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║           ${PRODUCT.name} 스케줄러
╚════════════════════════════════════════════════════════════════╝

상품: ${PRODUCT.keyword}
MID: ${PRODUCT.mid}
스케줄: ${CONFIG.customSchedule.map(s => `${s.hour}:${String(s.minute).padStart(2, "0")}`).join(", ")}
요청/회: ${CONFIG.baseCount} ± ${CONFIG.variance}
예상 일일: ~${CONFIG.customSchedule.length * CONFIG.baseCount}회
로그: ${CONFIG.logDir}

[오늘 목표: 2000~2100회]
`);
}

async function main() {
  printHeader();

  if (process.argv.includes("--now")) {
    log("즉시 실행 모드");
    await runMassRotation(getRandomCount());
  }

  scheduleNext();
}

main().catch(console.error);
