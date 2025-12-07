/**
 * TURAFIC Auto-Updater
 *
 * 1000?� PC????번만 배포?�면, ?�후 ?�동?�로 최신 Runner�??�운로드?�고 ?�행?�니??
 *
 * ?�용�?
 * 1. exe�?빌드: npx pkg updater/auto-updater.ts -t node18-win-x64 -o turafic-updater.exe
 * 2. ?�격 PC??배포: turafic-updater.exe + .env ?�일
 * 3. ?�행?�면 ?�동?�로 GitHub?�서 최신 Runner ?�운로드 ???�행
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { spawn, ChildProcess } from 'child_process';
import { loadConfig, loadConfigAsync, printConfig, createSampleConfig, UpdaterConfig } from './config';

// dotenv 로드 (?�으�?
try {
  require('dotenv').config();
} catch (e) {
  // dotenv가 ?�어??OK - ?�경변??직접 ?�용
}

interface VersionInfo {
  version: string;
  timestamp: number;
  hash?: string;
  files?: Record<string, string>;
}

class AutoUpdater {
  private config: UpdaterConfig;
  private runnerProcess: ChildProcess | null = null;
  private localVersion: VersionInfo | null = null;
  private isUpdating = false;

  constructor() {
    this.config = loadConfig(); // 동기 로드 (초기)
  }

  /**
   * 메인 ?�행
   */
  async run(): Promise<void> {
    // DB에서 설정 로드 (hostname으로 nodeType 조회)
    this.config = await loadConfigAsync();
    console.log('\n?? TURAFIC Auto-Updater ?�작\n');
    printConfig(this.config);

    // 로컬 ?�렉?�리 ?�성
    this.ensureLocalDir();

    // �??�플 config ?�성 (?�으�?
    if (!fs.existsSync(path.join(this.config.localDir, 'config.json'))) {
      createSampleConfig(this.config.localDir);
    }

    // ?�작 ??즉시 ?�데?�트 체크
    console.log('[Updater] 초기 ?�데?�트 체크...');
    await this.checkAndUpdate();

    // Runner ?�행
    await this.startRunner();

    // 주기???�데?�트 체크 (Runner ?�행 중에??
    console.log(`[Updater] ${this.config.checkIntervalMs / 1000}초마???�데?�트 체크 ?�작`);
    setInterval(async () => {
      await this.checkAndUpdate();
    }, this.config.checkIntervalMs);

    // ?�로?�스 종료 ?�들�?    this.setupGracefulShutdown();
  }

  /**
   * 로컬 ?�렉?�리 ?�성
   */
  private ensureLocalDir(): void {
    if (!fs.existsSync(this.config.localDir)) {
      fs.mkdirSync(this.config.localDir, { recursive: true });
      console.log(`[Updater] 로컬 ?�렉?�리 ?�성: ${this.config.localDir}`);
    }
  }

  /**
   * ?�격 version.json�?비교 ???�데?�트
   */
  async checkAndUpdate(): Promise<boolean> {
    if (this.isUpdating) {
      console.log('[Updater] ?��? ?�데?�트 �?..');
      return false;
    }

    this.isUpdating = true;

    try {
      // 1. ?�격 version.json 가?�오�?      const remoteVersionUrl = `${this.config.githubRawBase}/version.json`;
      const remoteVersion = await this.fetchJson<VersionInfo>(remoteVersionUrl);

      if (!remoteVersion) {
        console.log('[Updater] ?�격 버전 ?�보 ?�음, ?�킵');
        return false;
      }

      // 2. 로컬 version.json ?�기
      const localVersionPath = path.join(this.config.localDir, 'version.json');
      if (fs.existsSync(localVersionPath)) {
        try {
          this.localVersion = JSON.parse(fs.readFileSync(localVersionPath, 'utf-8'));
        } catch (e) {
          this.localVersion = null;
        }
      }

      // 3. 버전 비교
      if (this.localVersion && this.localVersion.timestamp >= remoteVersion.timestamp) {
        console.log(`[Updater] 최신 버전 (${this.localVersion.version})`);
        return false;
      }

      // 4. ?�데?�트 ?�요!
      console.log(`\n[Updater] ?�� ??버전 발견!`);
      console.log(`  ?�재: ${this.localVersion?.version || '?�음'}`);
      console.log(`  최신: ${remoteVersion.version}\n`);

      // 5. 모든 ?�일 ?�운로드
      for (const file of this.config.files) {
        const fileUrl = `${this.config.githubRawBase}/${file}`;
        const localPath = path.join(this.config.localDir, file);

        console.log(`[Updater] ?�운로드: ${file}`);
        await this.downloadFile(fileUrl, localPath);
      }

      // 6. 로컬 버전 ?�보 ?�??      fs.writeFileSync(localVersionPath, JSON.stringify(remoteVersion, null, 2));
      this.localVersion = remoteVersion;

      console.log('[Updater] ???�데?�트 ?�료!\n');

      // 7. Runner ?�시??(?�행 중이�?
      if (this.runnerProcess) {
        console.log('[Updater] Runner ?�시??�?..');
        await this.restartRunner();
      }

      return true;
    } catch (error) {
      console.error('[Updater] ?�데?�트 체크 ?�패:', error);
      return false;
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Runner ?�작
   */
  private async startRunner(): Promise<void> {
    let runnerFile: string;
    let useNpxTsx = false;

    // nodeType???�라 ?�행???�일 결정
    if (this.config.nodeType === 'prb') {
      runnerFile = 'unified-runner.ts';
      useNpxTsx = true;  // PRB (puppeteer-real-browser)
    } else if (this.config.nodeType === 'playwright') {
      runnerFile = 'parallel-ip-rotation-playwright.ts';
      useNpxTsx = true;  // TypeScript ?�일?� npx tsx�??�행
    } else if (this.config.nodeType === 'experiment') {
      runnerFile = 'experiment-runner.js';
    } else {
      runnerFile = 'worker-runner.js';
    }

    const runnerPath = path.join(this.config.localDir, runnerFile);

    if (!fs.existsSync(runnerPath)) {
      console.error(`[Updater] Runner ?�일 ?�음: ${runnerPath}`);
      console.log('[Updater] ?�데?�트 ???�시 ?�도?�니??..');
      await this.checkAndUpdate();

      if (!fs.existsSync(runnerPath)) {
        console.error('[Updater] ??Runner ?�운로드 ?�패. GitHub ?�포�??�인?�세??');
        return;
      }
    }

    console.log(`\n[Updater] ?�� Runner ?�작: ${runnerFile}`);
    console.log(`  Node Type: ${this.config.nodeType}`);
    console.log(`  Node ID: ${this.config.nodeId}`);
    console.log(`  Executor: ${useNpxTsx ? 'npx tsx' : 'node'}\n`);

    // ?�경변???�달
    const env = {
      ...process.env,
      NODE_TYPE: this.config.nodeType,
      NODE_ID: this.config.nodeId,
      DATABASE_URL: this.config.databaseUrl,
      SERVER_URL: this.config.serverUrl || '',
    };

    // Playwright (TypeScript)??npx tsx�??�행, ?�머지??node�??�행
    if (useNpxTsx) {
      this.runnerProcess = spawn('npx', ['tsx', runnerPath], {
        cwd: this.config.localDir,
        env,
        stdio: 'inherit',
        shell: true,
      });
    } else {
      this.runnerProcess = spawn('node', [runnerPath], {
        cwd: this.config.localDir,
        env,
        stdio: 'inherit',
      });
    }

    this.runnerProcess.on('exit', (code) => {
      console.log(`[Updater] Runner 종료 (code: ${code})`);
      this.runnerProcess = null;

      // 비정??종료 ???�시??      if (code !== 0) {
        console.log('[Updater] 5�????�시??..');
        setTimeout(() => this.startRunner(), 5000);
      }
    });

    this.runnerProcess.on('error', (error) => {
      console.error('[Updater] Runner ?�행 ?�류:', error);
    });
  }

  /**
   * Runner ?�시??   */
  private async restartRunner(): Promise<void> {
    if (this.runnerProcess) {
      console.log('[Updater] 기존 Runner 종료 �?..');

      return new Promise((resolve) => {
        this.runnerProcess!.once('exit', () => {
          console.log('[Updater] Runner 종료??);
          setTimeout(async () => {
            await this.startRunner();
            resolve();
          }, 1000);
        });

        // SIGTERM ?�송
        this.runnerProcess!.kill('SIGTERM');

        // 5�???강제 종료
        setTimeout(() => {
          if (this.runnerProcess) {
            this.runnerProcess.kill('SIGKILL');
          }
        }, 5000);
      });
    } else {
      await this.startRunner();
    }
  }

  /**
   * HTTP(S) JSON 가?�오�?   */
  private fetchJson<T>(url: string): Promise<T | null> {
    return new Promise((resolve) => {
      const client = url.startsWith('https') ? https : http;

      // 캐시 방�????�?�스?�프 추�?
      const urlWithCache = `${url}?t=${Date.now()}`;

      client.get(urlWithCache, (res) => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(null);
          }
        });
      }).on('error', () => resolve(null));
    });
  }

  /**
   * ?�일 ?�운로드
   */
  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const urlWithCache = `${url}?t=${Date.now()}`;

      // ?�시 ?�일�??�운로드
      const tmpPath = `${dest}.tmp`;
      const dir = path.dirname(dest);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const file = fs.createWriteStream(tmpPath);

      client.get(urlWithCache, (res) => {
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(tmpPath);
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          // 기존 ?�일 백업 ??교체
          if (fs.existsSync(dest)) {
            const backupPath = `${dest}.bak`;
            fs.copyFileSync(dest, backupPath);
          }
          fs.renameSync(tmpPath, dest);
          resolve();
        });
      }).on('error', (err) => {
        file.close();
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        reject(err);
      });
    });
  }

  /**
   * ?�상 종료 처리
   */
  private setupGracefulShutdown(): void {
    const shutdown = () => {
      console.log('\n[Updater] 종료 �?..');
      if (this.runnerProcess) {
        this.runnerProcess.kill('SIGTERM');
      }
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

// 메인 ?�행
const updater = new AutoUpdater();
updater.run().catch((error) => {
  console.error('[Updater] 치명???�류:', error);
  process.exit(1);
});

