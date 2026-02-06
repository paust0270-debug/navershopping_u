/**
 * TURAFIC Shopping Tab Launcher (쇼핑탭 메인 러너용)
 *
 * 역할:
 * 1. Git/Node.js 설치 확인
 * 2. git clone (최초) 또는 git pull (업데이트)
 * 3. npm install (puppeteer-real-browser 자동 설치)
 * 4. setup-env.bat 자동 실행 (최초 1회)
 * 5. unified-runner-shopping-tab.ts 실행 (메인 테이블)
 * 6. 에러나면 재시작
 *
 * 이 파일은 거의 안 바뀜 - exe로 빌드해서 배포
 * 실제 로직은 unified-runner-shopping-tab.ts에 있음 (git pull로 자동 업데이트)
 *
 * 빌드: npm run build:shopping-tab-launcher-exe
 */

import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

// pkg 빌드 시 process.pkg 타입 선언
declare const process: NodeJS.Process & { pkg?: boolean; execPath: string };

// dotenv 로드
try {
  require('dotenv').config();
} catch (e) {}

// 작업 디렉토리 결정 (D드라이브 우선, 없으면 C드라이브)
function determineWorkDir(): string {
  const dDriveDir = 'D:\\Project\\turafic_update';
  const cDriveDir = 'C:\\Users\\User\\turafic_update';

  try {
    // D드라이브 존재 확인
    if (fs.existsSync('D:\\')) {
      return dDriveDir;
    }
  } catch (e) {}

  return cDriveDir;
}

const WORK_DIR = determineWorkDir();
const RUNNER_FILE = 'unified-runner-shopping-tab.ts';
const GIT_PULL_INTERVAL = 3 * 60 * 1000; // 3분마다 git pull
const RESTART_DELAY = 5000; // 에러 시 5초 후 재시작
const GIT_REPO_URL = 'https://github.com/mim1012/turafic_update.git';
const FIRST_RUN_FLAG = path.join(WORK_DIR, '.shopping-tab-launcher-installed');

// 로그 파일 경로 (WORK_DIR 내부, 없으면 TEMP 폴더)
function getLogFilePath(): string {
  if (fs.existsSync(WORK_DIR)) {
    return path.join(WORK_DIR, 'shopping-tab-launcher.log');
  }
  // WORK_DIR이 없으면 TEMP 폴더 사용
  const tempDir = process.env.TEMP || process.env.TMP || 'C:\\Windows\\Temp';
  return path.join(tempDir, 'shopping-tab-launcher.log');
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
      logStream.write(`\n========== Test Launcher Started ==========\n`);
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
 * PC의 고유 식별자 생성 (MAC 주소 기반)
 */
function generateEquipmentName(): string {
  const networkInterfaces = os.networkInterfaces();

  // 활성 네트워크 인터페이스에서 MAC 주소 추출
  for (const [name, interfaces] of Object.entries(networkInterfaces)) {
    if (!interfaces) continue;

    for (const iface of interfaces) {
      // 루프백이 아니고 MAC 주소가 있는 인터페이스
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        // MAC 주소 마지막 6자리 + PC 이름 조합
        const macSuffix = iface.mac.replace(/:/g, '').slice(-6).toUpperCase();
        const hostname = os.hostname().replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
        return `${hostname}_${macSuffix}`;
      }
    }
  }

  // 폴백: PC 이름 + 랜덤 해시
  const hostname = os.hostname().replace(/[^a-zA-Z0-9]/g, '');
  const randomHash = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${hostname}_${randomHash}`;
}

/**
 * .env 파일 자동 생성 (없을 경우)
 */
function ensureEnvFile(workDir: string): void {
  const envPath = path.join(workDir, '.env');

  // .env 파일이 이미 존재하면 스킵
  if (fs.existsSync(envPath)) {
    log('.env 파일 존재 - 스킵');
    return;
  }

  log('.env 파일 없음 - 자동 생성 중...');

  // EQUIPMENT_NAME 생성
  const equipmentName = generateEquipmentName();

  // 기본 환경변수 템플릿
  const defaultEnv = `# TURAFIC 자동 생성 환경변수 (${new Date().toISOString()})

# Supabase Production DB (기본값)
SUPABASE_PRODUCTION_URL=https://sltckvbyzntxwutsyvfb.supabase.co
SUPABASE_PRODUCTION_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsdGNrdmJ5em50eHd1dHN5dmZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzYzMzQyNzIsImV4cCI6MjA1MTkxMDI3Mn0.1dGvH9jy1aQqWxqPCQoTvnT8kzlRqEEY9YEoZKRj1Yk

# Supabase Control DB (기본값 - 옵션)
SUPABASE_CONTROL_URL=https://rwqvgqhlzthwbqoxhmsd.supabase.co
SUPABASE_CONTROL_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3cXZncWhsenRod2Jxb3hobXNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzcxMDcwMDIsImV4cCI6MjA1MjY4MzAwMn0.VUkMJqEOlx4W-IqWUmQWsFgC7jV3K7vAOqL2aNlWrHA

# 장비 고유 이름 (자동 생성)
EQUIPMENT_NAME=${equipmentName}

# 옵션 설정
IP_ROTATION_METHOD=auto
NETWORK_CAPTURE=false
`;

  fs.writeFileSync(envPath, defaultEnv, 'utf8');
  log(`✅ .env 파일 생성 완료 (EQUIPMENT_NAME: ${equipmentName})`);
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
 * Node.js 설치 확인 및 경로 찾기
 */
function checkNodeInstalled(): { installed: boolean; nodePath?: string; npmPath?: string; error?: string } {
  // 방법 1: PATH 환경변수에서 찾기
  try {
    const version = execSync('node --version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: 'pipe'
    }).trim();

    log(`Node.js 버전: ${version}`);

    // node 경로 찾기
    try {
      const nodePath = execSync('where node', {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: 'pipe'
      }).trim().split('\n')[0].trim();

      const npmPath = execSync('where npx', {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: 'pipe'
      }).trim().split('\n')[0].trim();

      log(`Node.js 경로: ${nodePath}`);
      log(`npx 경로: ${npmPath}`);

      return { installed: true, nodePath, npmPath };
    } catch (e2) {
      // where 명령 실패해도 node --version이 성공했으면 설치된 것
      return { installed: true };
    }
  } catch (e: any) {
    log('PATH에서 Node.js를 찾을 수 없습니다. 일반적인 설치 경로를 확인합니다...');

    // 방법 2: 일반적인 설치 경로 직접 체크
    const commonPaths = [
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'nodejs\\node.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'nodejs\\node.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs\\nodejs\\node.exe'),
      path.join(process.env.APPDATA || '', 'npm\\node.exe')
    ];

    for (const nodePath of commonPaths) {
      if (fs.existsSync(nodePath)) {
        const nodeDir = path.dirname(nodePath);
        const npxPath = path.join(nodeDir, 'npx.cmd');

        log(`Node.js 발견: ${nodePath}`);

        // 발견한 경로로 버전 확인
        try {
          const version = execSync(`"${nodePath}" --version`, {
            encoding: 'utf-8',
            timeout: 5000,
            stdio: 'pipe'
          }).trim();

          log(`Node.js 버전: ${version}`);

          return {
            installed: true,
            nodePath,
            npmPath: fs.existsSync(npxPath) ? npxPath : undefined
          };
        } catch (e3) {
          log(`경로는 존재하지만 실행 실패: ${nodePath}`);
          continue;
        }
      }
    }

    // 모든 방법 실패
    return {
      installed: false,
      error: e.message || 'Node.js를 찾을 수 없습니다'
    };
  }
}

/**
 * 최초 실행 확인
 */
function isFirstRun(): boolean {
  return !fs.existsSync(FIRST_RUN_FLAG);
}

/**
 * 최초 설치 프로세스
 */
async function firstTimeSetup(): Promise<boolean> {
  try {
    log('');
    log('==================================================');
    log('  최초 설치 시작');
    log('==================================================');
    log('');

    // 1. npm install
    log('[1/2] npm 패키지 설치 중... (2-5분 소요)');
    execSync('npm install', {
      cwd: WORK_DIR,
      encoding: 'utf-8',
      timeout: 600000,  // 10분
      stdio: 'inherit'
    });

    log('✅ 패키지 설치 완료 (puppeteer-real-browser 포함)');
    log('');
    log('ℹ️  참고: puppeteer-real-browser는 첫 실행 시 자동으로 Chromium을 다운로드합니다.');
    log('');

    // 2. setup-env.bat 실행
    log('[2/2] 환경 설정 (setup-env.bat)');
    log('');
    log('장비 이름을 입력하세요 (예: 네이버1, 네이버2, PC12 등):');
    try {
      execSync('setup-env.bat', {
        cwd: WORK_DIR,
        encoding: 'utf-8',
        timeout: 300000,  // 5분 (사용자 입력 대기)
        stdio: 'inherit'
      });
    } catch (e: any) {
      log('setup-env.bat 실행 실패 (무시하고 계속): ' + e.message);
    }

    // 3. 플래그 파일 생성
    fs.writeFileSync(FIRST_RUN_FLAG, new Date().toISOString());

    log('');
    log('==================================================');
    log('  최초 설치 완료!');
    log('==================================================');
    log('');

    return true;
  } catch (e: any) {
    log('최초 설치 실패: ' + e.message);
    log('');
    log('수동 설치 방법:');
    log(`1. cd ${WORK_DIR}`);
    log('2. npm install');
    log('3. npx patchright install chromium');
    log('4. setup-env.bat');
    log('');
    await waitForKey('아무 키나 눌러 종료...');
    return false;
  }
}

/**
 * 의존성 설치 (기존 설치 시)
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

    log('✅ puppeteer-real-browser는 첫 실행 시 자동으로 Chromium을 다운로드합니다.');

    log('설치 완료');
    return true;
  } catch (e: any) {
    log('설치 실패: ' + e.message);
    log(`수동 설치 필요: cd ${WORK_DIR} && npm install && npx patchright install chromium`);
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
  console.log('  TURAFIC Shopping Tab Launcher');
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

  // Node.js 설치 확인
  const nodeResult = checkNodeInstalled();
  if (!nodeResult.installed) {
    log('ERROR: Node.js가 설치되지 않았습니다!');
    log('');
    log('에러 상세: ' + (nodeResult.error || '알 수 없는 오류'));
    log('');
    log('확인한 경로:');
    log('- C:\\Program Files\\nodejs\\node.exe');
    log('- C:\\Program Files (x86)\\nodejs\\node.exe');
    log('- %LOCALAPPDATA%\\Programs\\nodejs\\node.exe');
    log('');
    log('현재 PATH 환경변수:');
    log(process.env.PATH || '(없음)');
    log('');
    log('Node.js 설치 방법:');
    log('1. https://nodejs.org 에서 Node.js LTS 버전 다운로드');
    log('2. 설치 후 컴퓨터 재시작');
    log('3. 재시작 후에도 문제가 지속되면 PATH 환경변수에 수동 추가');
    await waitForKey('아무 키나 눌러 종료...');
    process.exit(1);
  }

  log('Node.js 확인 완료');

  // Node.js 경로를 전역 변수로 저장 (startRunner에서 사용)
  if (nodeResult.nodePath) {
    const nodeDir = path.dirname(nodeResult.nodePath);
    // PATH 앞에 추가하여 우선순위 부여
    process.env.PATH = nodeDir + path.delimiter + (process.env.PATH || '');
    log('Node.js 경로를 PATH에 추가: ' + nodeDir);
  }

  // 작업 디렉토리 존재 확인 및 자동 클론
  if (!fs.existsSync(WORK_DIR)) {
    log('작업 디렉토리가 없습니다. 자동 클론 시작...');
    const cloneOk = await gitClone();
    if (!cloneOk) {
      process.exit(1);
    }

    // 환경변수 자동 생성 (클론 직후)
    ensureEnvFile(WORK_DIR);
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

      // 환경변수 자동 생성 (클론 직후)
      ensureEnvFile(WORK_DIR);
    }
  }

  // 최초 실행 여부 확인
  if (isFirstRun()) {
    log('최초 실행 감지');

    // git pull 먼저 (클론 직후)
    await gitPull(false);

    // 최초 설치 프로세스
    const setupOk = await firstTimeSetup();
    if (!setupOk) {
      process.exit(1);
    }
  } else {
    log('기존 설치 감지');

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
  }

  // .env 파일 검증
  const envPath = path.join(WORK_DIR, '.env');
  if (!fs.existsSync(envPath)) {
    log('경고: .env 파일이 없습니다.');
    log('setup-env.bat을 실행하거나 수동으로 .env 파일을 생성하세요.');
    await waitForKey('계속하려면 아무 키나 누르세요...');
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
