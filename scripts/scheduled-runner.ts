/**
 * Scheduled Mass Rotation Runner
 *
 * 24시간 동안 일정 간격으로 자동 실행
 * 기본: 3시간 간격 (하루 8회)
 * 요청 수: 300 ± 24 (276~324)
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

// 설정
const CONFIG = {
  // 실행 간격 (시간 단위)
  intervalHours: 1.5,  // 1.5시간마다

  // 또는 특정 시간대 지정 (이 옵션 사용 시 intervalHours 무시)
  // 비워두면 intervalHours 사용
  customSchedule: [
    { hour: 14, minute: 0 },   // 오후 2시
    { hour: 15, minute: 30 },  // 오후 3시 30분
    { hour: 17, minute: 0 },   // 오후 5시
    { hour: 18, minute: 30 },  // 오후 6시 30분
    { hour: 20, minute: 0 },   // 오후 8시
    { hour: 21, minute: 30 },  // 오후 9시 30분
  ] as { hour: number; minute: number }[],

  // 요청 수 설정
  baseCount: 333,
  variance: 10,  // ±10 (333 ± 10 = 323~343)

  // 스크립트 경로
  scriptPath: path.join(__dirname, "mass-rotation-runner.ts"),

  // 로그 디렉토리
  logDir: path.join(__dirname, "..", "logs", "scheduled"),
};

// 간격 기반으로 스케줄 생성
function generateScheduleFromInterval(intervalHours: number): { hour: number; minute: number }[] {
  const schedule: { hour: number; minute: number }[] = [];
  for (let hour = 0; hour < 24; hour += intervalHours) {
    schedule.push({ hour, minute: 0 });
  }
  return schedule;
}

// 실제 사용할 스케줄
const SCHEDULE = CONFIG.customSchedule.length > 0
  ? CONFIG.customSchedule
  : generateScheduleFromInterval(CONFIG.intervalHours);

// 로그 디렉토리 생성
if (!fs.existsSync(CONFIG.logDir)) {
  fs.mkdirSync(CONFIG.logDir, { recursive: true });
}

function log(message: string) {
  const timestamp = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);

  // 파일에도 기록
  const logFile = path.join(CONFIG.logDir, `scheduler-${new Date().toISOString().split("T")[0]}.log`);
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

  // 오늘 남은 스케줄 확인
  for (let i = 0; i < SCHEDULE.length; i++) {
    const slot = SCHEDULE[i];
    const scheduledTime = new Date(today);
    scheduledTime.setHours(slot.hour, slot.minute, 0, 0);

    if (scheduledTime > now) {
      return { time: scheduledTime, index: i };
    }
  }

  // 오늘 스케줄이 모두 지났으면 내일 첫 번째 스케줄
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(SCHEDULE[0].hour, SCHEDULE[0].minute, 0, 0);
  return { time: tomorrow, index: 0 };
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);

  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  } else if (minutes > 0) {
    return `${minutes}분 ${seconds}초`;
  }
  return `${seconds}초`;
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

async function runMassRotation(count: number): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    log(`실행 시작: ${count}회 요청 [${PRODUCT_NAME}]`);

    const startTime = Date.now();
    const outputFile = path.join(CONFIG.logDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
    const outputStream = fs.createWriteStream(outputFile);

    // 기본 인자 + 상품 정보 인자
    const spawnArgs = ["tsx", CONFIG.scriptPath, "--count", count.toString(), ...PRODUCT_ARGS];
    log(`명령어: npx ${spawnArgs.join(" ")}`);

    const child = spawn("npx", spawnArgs, {
      cwd: path.join(__dirname, ".."),
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    child.stdout?.on("data", (data) => {
      const text = data.toString();
      output += text;
      outputStream.write(text);

      // Progress 로그만 콘솔에 출력
      if (text.includes("Progress:") || text.includes("SUMMARY")) {
        process.stdout.write(text);
      }
    });

    child.stderr?.on("data", (data) => {
      const text = data.toString();
      output += text;
      outputStream.write(text);
    });

    child.on("close", (code) => {
      outputStream.end();
      const duration = Date.now() - startTime;

      if (code === 0) {
        // 결과 파싱
        const successMatch = output.match(/Success:\s*(\d+)/);
        const failedMatch = output.match(/Failed:\s*(\d+)/);
        const success = successMatch ? parseInt(successMatch[1]) : 0;
        const failed = failedMatch ? parseInt(failedMatch[1]) : 0;

        log(`실행 완료: ${success}/${count} 성공, ${failed} 실패 (${formatDuration(duration)})`);
        log(`로그 저장: ${outputFile}`);
        resolve({ success: true, output });
      } else {
        log(`실행 실패: exit code ${code}`);
        resolve({ success: false, output });
      }
    });

    child.on("error", (err) => {
      outputStream.end();
      log(`실행 에러: ${err.message}`);
      resolve({ success: false, output: err.message });
    });
  });
}

async function scheduleNext() {
  const { time: nextTime, index } = getNextScheduledTime();
  const delay = nextTime.getTime() - Date.now();

  log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log(`다음 실행 예약: ${nextTime.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);
  log(`대기 시간: ${formatDuration(delay)}`);
  log(`스케줄 슬롯: ${index + 1}/${SCHEDULE.length}`);
  log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  setTimeout(async () => {
    const count = getRandomCount();
    await runMassRotation(count);

    // 다음 스케줄 예약
    scheduleNext();
  }, delay);
}

function printSchedule() {
  const dailyRuns = SCHEDULE.length;
  const dailyRequests = dailyRuns * CONFIG.baseCount;

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║           SCHEDULED MASS ROTATION RUNNER                       ║
╚════════════════════════════════════════════════════════════════╝

상품: ${PRODUCT_NAME}
상품 인자: ${PRODUCT_ARGS.length > 0 ? PRODUCT_ARGS.join(" ") : "(기본값)"}
실행 간격: ${CONFIG.intervalHours}시간마다
하루 실행 횟수: ${dailyRuns}회
하루 총 요청 수: ~${dailyRequests}회

스케줄 (${dailyRuns}회/일):
${SCHEDULE.map((s, i) => `  ${String(i + 1).padStart(2, " ")}. ${formatTime(s.hour, s.minute)}`).join("\n")}

요청 수/회: ${CONFIG.baseCount} ± ${CONFIG.variance} (${CONFIG.baseCount - CONFIG.variance}~${CONFIG.baseCount + CONFIG.variance})
로그 디렉토리: ${CONFIG.logDir}

Ctrl+C로 종료
`);
}

// 상품 정보 (CLI 인자로 덮어쓰기 가능)
let PRODUCT_ARGS: string[] = [];
let PRODUCT_NAME = "기본상품";

// 메인 실행
async function main() {
  // CLI 인자 파싱
  const args = process.argv.slice(2);

  // 간격 설정 (--interval 또는 -i)
  const intervalIdx = args.findIndex(a => a === "--interval" || a === "-i");
  if (intervalIdx !== -1 && args[intervalIdx + 1]) {
    const interval = parseInt(args[intervalIdx + 1]);
    if (interval >= 1 && interval <= 12) {
      CONFIG.intervalHours = interval;
    }
  }

  // 상품 정보 파싱 (mass-rotation-runner에 전달)
  const midIdx = args.findIndex(a => a === "--mid");
  if (midIdx !== -1 && args[midIdx + 1]) {
    PRODUCT_ARGS.push("--mid", args[midIdx + 1]);
    PRODUCT_NAME = `MID:${args[midIdx + 1]}`;
  }

  const keywordIdx = args.findIndex(a => a === "--keyword");
  if (keywordIdx !== -1 && args[keywordIdx + 1]) {
    PRODUCT_ARGS.push("--keyword", args[keywordIdx + 1]);
    PRODUCT_NAME = args[keywordIdx + 1];
  }

  const mallIdx = args.findIndex(a => a === "--mall");
  if (mallIdx !== -1 && args[mallIdx + 1]) {
    PRODUCT_ARGS.push("--mall", args[mallIdx + 1]);
  }

  // 스케줄 재생성 (customSchedule이 없을 때만)
  if (CONFIG.customSchedule.length === 0) {
    const schedule = generateScheduleFromInterval(CONFIG.intervalHours);
    SCHEDULE.length = 0;
    SCHEDULE.push(...schedule);
  }

  printSchedule();

  // 즉시 실행 옵션 확인
  if (args.includes("--now") || args.includes("-n")) {
    log("즉시 실행 모드");
    const count = getRandomCount();
    await runMassRotation(count);
  }

  // 스케줄 시작
  scheduleNext();
}

main().catch(console.error);
