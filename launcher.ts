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

// 엔진 폴더 경로 (환경변수 또는 기본값)
const WORK_DIR = process.env.TURAFIC_DIR || 'C:\\turafic';
const RUNNER_FILE = 'unified-runner.ts';
const GIT_PULL_INTERVAL = 3 * 60 * 1000; // 3분마다 git pull
const RESTART_DELAY = 5000; // 에러 시 5초 후 재시작
const GIT_REPO_URL = 'https://github.com/mim1012/turafic_update.git';

// 로그 파일 경로 (WORK_DIR 내부, 없으면 TEMP 폴더)
function getLogFilePath(): string {
  if (fs.existsSync(WORK_DIR)) {
    return path.join(WORK_DIR, 'launcher.log');
  }
  // WORK_DIR이 없으면 TEMP 폴더 사용
  const tempDir = process.env.TEMP || process.env.TMP || 'C:\\Windows\\Temp';
  return path.join(tempDir, 'turafic-launcher.log');
}

// 로그 파일 스트림
let logStream: fs.WriteStream | null = null;
let logFileInitialized = false;

function log(msg: string) {
  const time = new Date().toISOString().substring(0, 19).replace('T', ' ');
  const logMsg = `[${time}] ${msg}`;

  // 콘솔 출력
  console.log(logMsg);

  // 파일 출력 (한 번 실패하면 더 이상 시도하지 않음)
  if (!logFileInitialized) {
    try {
      const logFile = getLogFilePath();
      logStream = fs.createWriteStream(logFile, { flags: 'a' });
      logFileInitialized = true;
      logStream.write(`\n========== Launcher Started ==========\n`);
    } catch (e) {
      // 로그 파일 열기 실패 시 콘솔에만 출력
      logFileInitialized = true; // 더 이상 시도하지 않음
    }
  }

  if (logStream) {
    try {
      logStream.write(logMsg + '\n');
    } catch (e) {
      // 쓰기 실패해도 계속 진행
    }
  }
}

function waitForKey(message: string = 'Press any key to continue...') {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise<void>((resolve) => {
    rl.question(message + '\n', () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Git 설치 확인
 */
function checkGitInstalled(): boolean {
  try {
    execSync('git --version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: 'pipe'
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 의존성 설치 (npm install + patchright 브라우저)
 */
async function installDependencies(): Promise<boolean> {
  try {
    const nodeModulesPath = path.join(WORK_DIR, 'node_modules');
    const patchrightPath = path.join(nodeModulesPath, 'patchright');

    // node_modules 없거나 patchright 없으면 npm install
    if (!fs.existsSync(nodeModulesPath) || !fs.existsSync(patchrightPath)) {
      log('의존성 설치 중... (최대 5분 소요)');
      execSync('npm install', {
        cwd: WORK_DIR,
        encoding: 'utf-8',
        timeout: 600000,  // 10분
        stdio: 'inherit'
      });
    } else {
      log('의존성 이미 설치됨');
    }

    // Patchright 브라우저 설치 체크
    const patchrightBrowserPath = path.join(
      process.env.LOCALAPPDATA || '',
      'patchright'
    );

    if (!fs.existsSync(patchrightBrowserPath)) {
      log('Patchright 브라우저 설치 중... (최대 10분 소요)');
      execSync('npx patchright install chromium', {
        cwd: WORK_DIR,
        encoding: 'utf-8',
        timeout: 600000,  // 10분
        stdio: 'inherit'
      });
    } else {
      log('Patchright 브라우저 이미 설치됨');
    }

    log('설치 완료');
    return true;
  } catch (e: any) {
    log('설치 실패: ' + e.message);
    log('수동 설치 필요: cd C:\\turafic && npm install && npx patchright install chromium');
    await waitForKey('아무 키나 눌러 종료...');
    return false;
  }
}

/**
 * git clone 실행
 */
async function gitClone(): Promise<boolean> {
  try {
    log('Git 저장소 클론 중... (최대 3분 소요)');
    log('Repository: ' + GIT_REPO_URL);
    log('Target: ' + WORK_DIR);

    // 부모 디렉토리 생성
    const parentDir = path.dirname(WORK_DIR);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    execSync(`git clone ${GIT_REPO_URL} ${WORK_DIR}`, {
      encoding: 'utf-8',
      timeout: 180000,  // 3분 (네트워크 느릴 수 있음)
      stdio: 'inherit'
    });

    log('클론 완료');
    return true;
  } catch (e: any) {
    log('Git 클론 실패: ' + e.message);
    log('');
    log('가능한 원인:');
    log('1. 인터넷 연결 문제');
    log('2. GitHub 접근 제한');
    log('3. 디스크 공간 부족');
    log('');
    log('수동 클론: git clone ' + GIT_REPO_URL + ' ' + WORK_DIR);
    await waitForKey('아무 키나 눌러 종료...');
    return false;
  }
}

/**
 * git pull 실행
 */
async function gitPull(failOnError: boolean = false): Promise<boolean> {
  try {
    log('Git 업데이트 중...');

    // 로컬 변경사항 무시하고 강제 업데이트
    execSync('git fetch origin main', {
      cwd: WORK_DIR,
      encoding: 'utf-8',
      timeout: 60000,  // 1분 (네트워크 느릴 수 있음)
      stdio: 'pipe'
    });

    execSync('git reset --hard origin/main', {
      cwd: WORK_DIR,
      encoding: 'utf-8',
      timeout: 10000,  // 10초
      stdio: 'pipe'
    });

    log('업데이트 완료');
    return true;
  } catch (e: any) {
    log('Git 업데이트 실패: ' + e.message);
    if (failOnError) {
      log('');
      log('가능한 원인:');
      log('1. 인터넷 연결 문제');
      log('2. Git 저장소가 손상됨');
      log('3. GitHub 접근 제한');
      await waitForKey('아무 키나 눌러 종료...');
    }
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
  console.log('  Log File: ' + getLogFilePath());
  console.log('========================================\n');

  // Git 설치 확인
  if (!checkGitInstalled()) {
    log('ERROR: Git이 설치되지 않았습니다!');
    log('');
    log('Git 설치 방법:');
    log('1. https://git-scm.com/download/win 에서 Git 다운로드');
    log('2. 설치 후 컴퓨터 재시작');
    log('');
    log('또는 Portable Git 사용:');
    log('https://git-scm.com/download/win -> "Portable" 버전 다운로드');
    await waitForKey('아무 키나 눌러 종료...');
    process.exit(1);
  }

  log('Git 확인 완료');

  // 작업 디렉토리 존재 확인 및 자동 클론
  if (!fs.existsSync(WORK_DIR)) {
    log('작업 디렉토리가 없습니다. 자동 클론 시작...');
    const cloneOk = await gitClone();
    if (!cloneOk) {
      process.exit(1);
    }
  } else {
    // 디렉토리는 있지만 .git이 없는 경우
    const gitDir = path.join(WORK_DIR, '.git');
    if (!fs.existsSync(gitDir)) {
      log('Git 저장소가 아닙니다. 기존 폴더를 백업 후 클론합니다...');
      const backupDir = WORK_DIR + '.backup.' + Date.now();
      try {
        fs.renameSync(WORK_DIR, backupDir);
        log('기존 폴더 백업: ' + backupDir);
      } catch (e: any) {
        log('백업 실패: ' + e.message);
        await waitForKey('아무 키나 눌러 종료...');
        process.exit(1);
      }

      const cloneOk = await gitClone();
      if (!cloneOk) {
        process.exit(1);
      }
    }
  }

  // 시작 시 git pull (실패 시 pause)
  const gitOk = await gitPull(true);
  if (!gitOk) {
    process.exit(1);
  }

  // 의존성 설치 체크 (실패 시 pause)
  const depsOk = await installDependencies();
  if (!depsOk) {
    process.exit(1);
  }

  // .env 파일 설정 (없으면 .env.example 복사)
  const envPath = path.join(WORK_DIR, '.env');
  const envExamplePath = path.join(WORK_DIR, '.env.example');

  let needsEnvSetup = false;

  if (!fs.existsSync(envPath)) {
    if (fs.existsSync(envExamplePath)) {
      log('.env 파일이 없습니다. .env.example을 복사합니다...');
      try {
        fs.copyFileSync(envExamplePath, envPath);
        log('.env 파일 생성 완료');
        needsEnvSetup = true;
      } catch (e: any) {
        log('.env 파일 복사 실패: ' + e.message);
      }
    } else {
      log('경고: .env 파일과 .env.example이 모두 없습니다.');
    }
  } else {
    // .env 파일 검증 (xxxxx 같은 placeholder 확인)
    try {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      if (envContent.includes('xxxxx') || envContent.includes('SUPABASE_PRODUCTION_URL=https://xxxxx')) {
        log('경고: .env 파일에 placeholder 값이 있습니다.');
        needsEnvSetup = true;
      } else {
        log('.env 파일 확인 완료');
      }
    } catch (e) {
      log('.env 파일 읽기 실패');
    }
  }

  if (needsEnvSetup) {
    log('');
    log('==================================================');
    log('  .env 파일 설정이 필요합니다!');
    log('==================================================');
    log('');
    log('경로: ' + envPath);
    log('');
    log('설정해야 할 항목:');
    log('1. SUPABASE_PRODUCTION_URL - Supabase 프로젝트 URL');
    log('2. SUPABASE_PRODUCTION_KEY - Supabase anon key');
    log('3. EQUIPMENT_NAME - 이 PC의 고유 이름');
    log('');
    log('설정 방법:');
    log('1. 메모장으로 위 파일 열기');
    log('2. xxxxx 부분을 실제 값으로 변경');
    log('3. 저장 후 launcher 재실행');
    log('');
    log('==================================================');
    await waitForKey('설정 후 아무 키나 눌러 계속...');
  }

  // 주기적 git pull (백그라운드)
  setInterval(async () => {
    const updated = await gitPull(false);
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
    await gitPull(false);
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

main().catch(async (e) => {
  log('치명적 에러: ' + e.message);
  log('스택 트레이스: ' + e.stack);
  await waitForKey('아무 키나 눌러 종료...');
  process.exit(1);
});
