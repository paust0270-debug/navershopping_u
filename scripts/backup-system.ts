/**
 * System Backup Script
 *
 * 시스템을 백업하고 다른 환경에서 빠르게 배포할 수 있도록 합니다.
 *
 * 사용법:
 *   npx tsx scripts/backup-system.ts                    # 전체 백업
 *   npx tsx scripts/backup-system.ts --no-profiles     # 프로필 제외
 *   npx tsx scripts/backup-system.ts --output backup   # 출력 폴더 지정
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const ROOT_DIR = path.join(__dirname, "..");

// 백업에 포함할 핵심 파일들
const CORE_FILES = [
  // 스크립트
  "scripts/mass-rotation-runner.ts",
  "scripts/scheduled-runner.ts",
  "scripts/backup-system.ts",

  // 엔진
  "engines-packet/mass-replay/ProfileManager.ts",
  "engines-packet/mass-replay/BatchScheduler.ts",
  "engines-packet/mass-replay/index.ts",
  "engines-packet/replay/MultiSendEngine.ts",
  "engines-packet/capture/BehaviorLogCaptor.ts",
  "engines-packet/builders/BehaviorLogBuilder.ts",
  "engines-packet/builders/ProductLogBuilder.ts",
  "engines-packet/types.ts",

  // 설정
  "package.json",
  "tsconfig.json",
  "ecosystem.config.js",

  // 실행 파일
  "start-scheduler.bat",
  "pm2-start.bat",

  // 문서
  "docs/SYSTEM-README.md",
];

// 백업에서 제외할 패턴
const EXCLUDE_PATTERNS = [
  "node_modules",
  ".git",
  "dist",
  "logs",
  ".env",
  "*.log",
  "*.zip",
];

interface BackupOptions {
  includeProfiles: boolean;
  outputDir: string;
}

function parseArgs(): BackupOptions {
  const args = process.argv.slice(2);
  return {
    includeProfiles: !args.includes("--no-profiles"),
    outputDir: args.includes("--output")
      ? args[args.indexOf("--output") + 1] || "backup"
      : "backup",
  };
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFile(src: string, dest: string): void {
  const destDir = path.dirname(dest);
  ensureDir(destDir);
  fs.copyFileSync(src, dest);
}

function copyDir(src: string, dest: string, excludePatterns: string[] = []): void {
  if (!fs.existsSync(src)) return;

  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // 제외 패턴 체크
    const shouldExclude = excludePatterns.some((pattern) => {
      if (pattern.startsWith("*")) {
        return entry.name.endsWith(pattern.slice(1));
      }
      return entry.name === pattern;
    });

    if (shouldExclude) continue;

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, excludePatterns);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

function getGitInfo(): { branch: string; commit: string; date: string } | null {
  try {
    const branch = execSync("git branch --show-current", { cwd: ROOT_DIR })
      .toString()
      .trim();
    const commit = execSync("git rev-parse --short HEAD", { cwd: ROOT_DIR })
      .toString()
      .trim();
    const date = execSync('git log -1 --format="%ci"', { cwd: ROOT_DIR })
      .toString()
      .trim();
    return { branch, commit, date };
  } catch {
    return null;
  }
}

async function backup(options: BackupOptions): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupName = `turafic-backup-${timestamp}`;
  const backupDir = path.join(ROOT_DIR, options.outputDir, backupName);

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    SYSTEM BACKUP                               ║
╚════════════════════════════════════════════════════════════════╝

백업 대상: ${ROOT_DIR}
출력 폴더: ${backupDir}
프로필 포함: ${options.includeProfiles ? "예" : "아니오"}
`);

  ensureDir(backupDir);

  // 1. 핵심 파일 복사
  console.log("📁 핵심 파일 복사 중...");
  for (const file of CORE_FILES) {
    const srcPath = path.join(ROOT_DIR, file);
    const destPath = path.join(backupDir, file);

    if (fs.existsSync(srcPath)) {
      copyFile(srcPath, destPath);
      console.log(`  ✓ ${file}`);
    } else {
      console.log(`  ⚠ ${file} (없음)`);
    }
  }

  // 2. 프로필 복사 (옵션)
  if (options.includeProfiles) {
    console.log("\n📁 프로필 복사 중...");
    const profilesDir = path.join(ROOT_DIR, "profiles");
    if (fs.existsSync(profilesDir)) {
      const profiles = fs.readdirSync(profilesDir).filter((p) => p.startsWith("profile_"));
      for (const profile of profiles) {
        const srcPath = path.join(profilesDir, profile);
        const destPath = path.join(backupDir, "profiles", profile);
        copyDir(srcPath, destPath, ["Cache", "Code Cache", "GPUCache", "Service Worker"]);
        console.log(`  ✓ ${profile}`);
      }
    }
  }

  // 3. 메타 정보 생성
  console.log("\n📝 메타 정보 생성 중...");
  const gitInfo = getGitInfo();
  const metaInfo = {
    timestamp: new Date().toISOString(),
    gitBranch: gitInfo?.branch || "unknown",
    gitCommit: gitInfo?.commit || "unknown",
    gitDate: gitInfo?.date || "unknown",
    includesProfiles: options.includeProfiles,
    files: CORE_FILES.filter((f) => fs.existsSync(path.join(ROOT_DIR, f))),
    config: {
      product: {
        mid: "89029512267",
        keyword: "신지모루 Qi2 3in1 맥세이프 무선 충전기",
      },
      schedule: "3시간 간격 (00:00, 03:00, 06:00, ...)",
      requestsPerRun: "300 ± 24",
    },
  };

  fs.writeFileSync(
    path.join(backupDir, "backup-meta.json"),
    JSON.stringify(metaInfo, null, 2)
  );
  console.log("  ✓ backup-meta.json");

  // 4. 빠른 시작 가이드 생성
  const quickStart = `# 빠른 시작 가이드

## 1. 설치
\`\`\`bash
cd ${backupName}
npm install
\`\`\`

## 2. Chrome 경로 확인
\`C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\` 존재 확인

## 3. 테스트 실행
\`\`\`bash
npx tsx scripts/mass-rotation-runner.ts --test
\`\`\`

## 4. 본격 실행 (300회)
\`\`\`bash
npx tsx scripts/mass-rotation-runner.ts --count 300
\`\`\`

## 5. 24시간 자동 실행
\`\`\`bash
npx tsx scripts/scheduled-runner.ts
\`\`\`

## 6. PM2 백그라운드 실행
\`\`\`bash
npm install -g pm2
pm2 start ecosystem.config.js
\`\`\`

---

백업 시점: ${new Date().toLocaleString("ko-KR")}
Git: ${gitInfo?.branch || "N/A"} @ ${gitInfo?.commit || "N/A"}
`;

  fs.writeFileSync(path.join(backupDir, "QUICK-START.md"), quickStart);
  console.log("  ✓ QUICK-START.md");

  // 5. ZIP 압축 (Windows)
  console.log("\n📦 ZIP 압축 중...");
  const zipPath = `${backupDir}.zip`;
  try {
    if (process.platform === "win32") {
      execSync(
        `powershell -Command "Compress-Archive -Path '${backupDir}' -DestinationPath '${zipPath}' -Force"`,
        { stdio: "inherit" }
      );
    } else {
      execSync(`zip -r "${zipPath}" "${backupDir}"`, { stdio: "inherit" });
    }
    console.log(`  ✓ ${path.basename(zipPath)}`);
  } catch (e) {
    console.log("  ⚠ ZIP 압축 실패 (폴더는 생성됨)");
  }

  // 6. 완료
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    백업 완료                                    ║
╚════════════════════════════════════════════════════════════════╝

폴더: ${backupDir}
ZIP:  ${zipPath}

배포 방법:
1. ZIP 파일을 새 환경으로 복사
2. 압축 해제
3. npm install
4. npx tsx scripts/mass-rotation-runner.ts --test
`);
}

// 메인 실행
const options = parseArgs();
backup(options).catch(console.error);
