/**
 * TURAFIC Launcher (단순 런처)
 *
 * 역할:
 * 1. git pull로 최신 코드 가져오기
 * 2. unified-runner.ts 실행
 * 3. 에러나면 재시작
 *
 * 이 파일은 거의 안 바뀜 - exe로 빌드해서 배포
 * 실제 로직은 unified-runner.ts에 있음 (git pull로 자동 업데이트)
 *
 * 빌드: npx pkg launcher.ts -t node18-win-x64 -o turafic-launcher.exe
 */

import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// pkg 빌드 시 process.pkg 타입 선언
declare const process: NodeJS.Process & { pkg?: boolean; execPath: string };

// dotenv 로드
try {
  require('dotenv').config();
} catch (e) {}

// 엔진 폴더 고정 경로 (exe는 D:\에, 엔진은 D:\turafic에 있음)
const WORK_DIR = 'D:\\turafic';
const RUNNER_FILE = 'unified-runner.ts';
const GIT_PULL_INTERVAL = 3 * 60 * 1000; // 3분마다 git pull
const RESTART_DELAY = 5000; // 에러 시 5초 후 재시작

function log(msg: string) {
  const time = new Date().toISOString().substring(0, 19).replace('T', ' ');
  console.log(`[${time}] ${msg}`);
}

/**
 * Patchright 설치 체크 및 자동 설치
 */
function installPatchright(): boolean {
  try {
    const patchrightPath = path.join(WORK_DIR, 'node_modules', 'patchright');

    if (fs.existsSync(patchrightPath)) {
      log('Patchright 이미 설치됨');
      return true;
    }

    log('Patchright 설치 중...');
    execSync('npm install patchright', {
      cwd: WORK_DIR,
      encoding: 'utf-8',
      timeout: 120000,
      stdio: 'inherit'
    });

    log('Patchright 브라우저 설치 중...');
    execSync('npx patchright install chromium', {
      cwd: WORK_DIR,
      encoding: 'utf-8',
      timeout: 300000,
      stdio: 'inherit'
    });

    log('Patchright 설치 완료');
    return true;
  } catch (e: any) {
    log('Patchright 설치 실패: ' + e.message);
    return false;
  }
}

/**
 * git pull 실행
 */
function gitPull(): boolean {
  try {
    log('Git 업데이트 중...');

    // 로컬 변경사항 무시하고 강제 업데이트
    execSync('git fetch origin main', {
      cwd: WORK_DIR,
      encoding: 'utf-8',
      timeout: 30000
    });

    const result = execSync('git reset --hard origin/main', {
      cwd: WORK_DIR,
      encoding: 'utf-8',
      timeout: 30000
    });

    log('업데이트 완료');
    return true;
  } catch (e: any) {
    log('Git 업데이트 실패: ' + e.message);
    return false;
  }
}

/**
 * Runner 실행
 */
function startRunner(): Promise<number> {
  return new Promise((resolve) => {
    const runnerPath = path.join(WORK_DIR, RUNNER_FILE);

    if (!fs.existsSync(runnerPath)) {
      log('Runner 파일 없음: ' + runnerPath);
      resolve(1);
      return;
    }

    log('Runner 시작: ' + RUNNER_FILE);

    const child = spawn('npx', ['tsx', runnerPath], {
      cwd: WORK_DIR,
      stdio: 'inherit',
      shell: true,
      env: process.env
    });

    child.on('exit', (code) => {
      log('Runner 종료 (code: ' + code + ')');
      resolve(code || 0);
    });

    child.on('error', (err) => {
      log('Runner 에러: ' + err.message);
      resolve(1);
    });
  });
}

/**
 * 메인 루프
 */
async function main() {
  console.log('\n========================================');
  console.log('  TURAFIC Launcher');
  console.log('========================================');
  console.log('  Work Dir: ' + WORK_DIR);
  console.log('  Runner: ' + RUNNER_FILE);
  console.log('  Git Pull Interval: ' + (GIT_PULL_INTERVAL / 1000) + 's');
  console.log('========================================\n');

  // 시작 시 git pull
  gitPull();

  // Patchright 설치 체크
  installPatchright();

  // 주기적 git pull (백그라운드)
  setInterval(() => {
    const updated = gitPull();
    if (updated) {
      log('새 버전 감지 - 다음 재시작 시 적용됨');
    }
  }, GIT_PULL_INTERVAL);

  // 무한 루프로 Runner 실행
  while (true) {
    const exitCode = await startRunner();

    if (exitCode !== 0) {
      log('비정상 종료, ' + (RESTART_DELAY / 1000) + '초 후 재시작...');
    } else {
      log('정상 종료, ' + (RESTART_DELAY / 1000) + '초 후 재시작...');
    }

    await new Promise(r => setTimeout(r, RESTART_DELAY));

    // 재시작 전 git pull
    gitPull();
  }
}

// 종료 시그널 처리
process.on('SIGINT', () => {
  log('종료 요청됨');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('종료 요청됨');
  process.exit(0);
});

main().catch((e) => {
  log('치명적 에러: ' + e.message);
  process.exit(1);
});
