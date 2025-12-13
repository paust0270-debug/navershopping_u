/**
 * Profile Manager - 다중 프로필 로테이션
 *
 * 핵심 기능:
 * - launchPersistentContext로 프로필 재사용
 * - patchright 사용 (내장 stealth 기능)
 * - UA + sec-ch-ua Client Hints 완전 일치
 * - 라운드 로빈 로테이션
 * - 프로필당 일일 제한
 */

import { chromium } from "patchright";
import type { BrowserContext, Page } from "patchright";
import * as fs from "fs";
import * as path from "path";
import type { LogFunction } from "../types";

// 실제 Chrome 경로
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

// ============================================================
//  타입 정의
// ============================================================

export interface ProfileConfig {
  profileDir: string;        // 프로필 디렉토리 경로 (default: "./profiles")
  profileCount: number;      // 총 프로필 수 (default: 20)
  headless: boolean;         // GUI 모드 (default: false)
  maxDailyRequests: number;  // 프로필당 일일 제한 (default: 80)
  cooldownMs: number;        // 프로필 재사용 간 쿨다운 (default: 30000)
}

export interface ProfileDevice {
  id: number;
  viewport: { width: number; height: number };
  userAgent: string;
  clientHints: Record<string, string>;
  platform: "windows" | "mac";
}

export interface ProfileInstance {
  id: number;
  profilePath: string;
  device: ProfileDevice;
  context: BrowserContext | null;
  page: Page | null;
  inUse: boolean;
  lastUsed: number;
  usageCount: number;
  dailyCount: number;
  dailyReset: number;  // 일일 리셋 타임스탬프
  blacklisted: boolean;
}

export interface ProfileStats {
  profileId: number;
  totalRequests: number;
  dailyRequests: number;
  successCount: number;
  failCount: number;
  blocked: boolean;
  lastUsed: string;
}

// ============================================================
//  디바이스 프리셋 (20개 - UA + sec-ch-ua 일치)
// ============================================================

const PROFILE_DEVICES: ProfileDevice[] = [
  // Windows Chrome 131 (14개 - 70%)
  {
    id: 1,
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "windows",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"15.0.0"',
      "sec-ch-ua-arch": '"x86"',
      "sec-ch-ua-bitness": '"64"',
      "sec-ch-ua-full-version-list": '"Chromium";v="131.0.0.0", "Google Chrome";v="131.0.0.0", "Not-A.Brand";v="99.0.0.0"',
    },
  },
  {
    id: 2,
    viewport: { width: 1366, height: 768 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "windows",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"10.0.0"',
      "sec-ch-ua-arch": '"x86"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 3,
    viewport: { width: 1536, height: 864 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    platform: "windows",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"10.0.0"',
      "sec-ch-ua-arch": '"x86"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 4,
    viewport: { width: 1920, height: 1200 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "windows",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"15.0.0"',
      "sec-ch-ua-arch": '"x86"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 5,
    viewport: { width: 1680, height: 1050 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "windows",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"10.0.0"',
      "sec-ch-ua-arch": '"x86"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 6,
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    platform: "windows",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"10.0.0"',
      "sec-ch-ua-arch": '"x86"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 7,
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    platform: "windows",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="129", "Google Chrome";v="129", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"10.0.0"',
      "sec-ch-ua-arch": '"x86"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 8,
    viewport: { width: 1600, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "windows",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"15.0.0"',
      "sec-ch-ua-arch": '"x86"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 9,
    viewport: { width: 1280, height: 720 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "windows",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"10.0.0"',
      "sec-ch-ua-arch": '"x86"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 10,
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "windows",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"11.0.0"',
      "sec-ch-ua-arch": '"x86"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 11,
    viewport: { width: 1366, height: 768 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    platform: "windows",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"10.0.0"',
      "sec-ch-ua-arch": '"x86"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 12,
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "windows",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"15.0.0"',
      "sec-ch-ua-arch": '"x86"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 13,
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "windows",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"10.0.0"',
      "sec-ch-ua-arch": '"x86"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 14,
    viewport: { width: 1600, height: 1200 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "windows",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"15.0.0"',
      "sec-ch-ua-arch": '"x86"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  // macOS Chrome (6개 - 30%)
  {
    id: 15,
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "mac",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-ch-ua-platform-version": '"14.0.0"',
      "sec-ch-ua-arch": '"arm"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 16,
    viewport: { width: 1680, height: 1050 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    platform: "mac",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-ch-ua-platform-version": '"13.0.0"',
      "sec-ch-ua-arch": '"arm"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 17,
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "mac",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-ch-ua-platform-version": '"14.0.0"',
      "sec-ch-ua-arch": '"arm"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 18,
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "mac",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-ch-ua-platform-version": '"12.0.0"',
      "sec-ch-ua-arch": '"x86"',  // Intel Mac
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 19,
    viewport: { width: 1512, height: 982 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "mac",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-ch-ua-platform-version": '"14.0.0"',
      "sec-ch-ua-arch": '"arm"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
  {
    id: 20,
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    platform: "mac",
    clientHints: {
      "sec-ch-ua": '"Chromium";v="129", "Google Chrome";v="129", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-ch-ua-platform-version": '"13.0.0"',
      "sec-ch-ua-arch": '"arm"',
      "sec-ch-ua-bitness": '"64"',
    },
  },
];

// ============================================================
//  ProfileManager 클래스
// ============================================================

export class ProfileManager {
  private log: LogFunction;
  private config: ProfileConfig;
  private profiles: Map<number, ProfileInstance> = new Map();
  private currentIndex: number = 0;

  constructor(config?: Partial<ProfileConfig>, logFn?: LogFunction) {
    this.log = logFn || console.log;

    this.config = {
      profileDir: config?.profileDir ?? "./profiles",
      profileCount: config?.profileCount ?? 20,
      headless: config?.headless ?? false,
      maxDailyRequests: config?.maxDailyRequests ?? 80,
      cooldownMs: config?.cooldownMs ?? 30000,
    };
  }

  /**
   * 프로필 디렉토리 초기화 (최초 1회)
   */
  async initializeProfiles(): Promise<void> {
    this.log(`[ProfileManager] Initializing ${this.config.profileCount} profiles in ${this.config.profileDir}`);

    // 프로필 디렉토리 생성
    if (!fs.existsSync(this.config.profileDir)) {
      fs.mkdirSync(this.config.profileDir, { recursive: true });
    }

    // 각 프로필 초기화
    for (let i = 1; i <= this.config.profileCount; i++) {
      const profilePath = path.join(this.config.profileDir, `profile_${String(i).padStart(2, "0")}`);

      if (!fs.existsSync(profilePath)) {
        fs.mkdirSync(profilePath, { recursive: true });
        this.log(`[ProfileManager] Created profile directory: ${profilePath}`);
      }

      // 프로필 인스턴스 초기화 (아직 브라우저 안 띄움)
      const device = PROFILE_DEVICES[(i - 1) % PROFILE_DEVICES.length];

      this.profiles.set(i, {
        id: i,
        profilePath,
        device,
        context: null,
        page: null,
        inUse: false,
        lastUsed: 0,
        usageCount: 0,
        dailyCount: 0,
        dailyReset: this.getTodayReset(),
        blacklisted: false,
      });
    }

    this.log(`[ProfileManager] Initialized ${this.profiles.size} profiles`);
  }

  /**
   * 특정 프로필로 브라우저 시작
   */
  async launchProfile(profileId: number): Promise<ProfileInstance> {
    const instance = this.profiles.get(profileId);
    if (!instance) {
      throw new Error(`Profile ${profileId} not found`);
    }

    if (instance.blacklisted) {
      throw new Error(`Profile ${profileId} is blacklisted`);
    }

    // 일일 리셋 확인
    this.checkDailyReset(instance);

    // 일일 제한 확인
    if (instance.dailyCount >= this.config.maxDailyRequests) {
      throw new Error(`Profile ${profileId} exceeded daily limit (${this.config.maxDailyRequests})`);
    }

    // 이미 실행 중이면 기존 인스턴스 반환
    if (instance.context && instance.page) {
      this.log(`[ProfileManager] Profile ${profileId} already running`);
      instance.inUse = true;
      return instance;
    }

    this.log(`[ProfileManager] Launching profile ${profileId}: ${instance.device.platform} ${instance.device.viewport.width}x${instance.device.viewport.height}`);

    // patchright + 실제 Chrome 사용 (아이콘/fingerprint 일치)
    const context = await chromium.launchPersistentContext(instance.profilePath, {
      executablePath: CHROME_PATH,  // 실제 설치된 Chrome 사용
      headless: this.config.headless,
      viewport: instance.device.viewport,
      userAgent: instance.device.userAgent,
      extraHTTPHeaders: instance.device.clientHints,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    const page = await context.newPage();

    // 추가 Anti-detection 스크립트
    await page.addInitScript(() => {
      // navigator.webdriver 숨기기
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });

      // Chrome 객체 에뮬레이션
      (window as any).chrome = {
        runtime: {},
        loadTimes: () => ({}),
        csi: () => ({}),
        app: {},
      };

      // Permissions API 패치
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: "prompt" } as PermissionStatus)
          : originalQuery(parameters);

      // navigator 속성 패치
      Object.defineProperty(navigator, "maxTouchPoints", { get: () => 0 });
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
      Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    });

    instance.context = context;
    instance.page = page;
    instance.inUse = true;
    instance.lastUsed = Date.now();
    instance.usageCount++;
    instance.dailyCount++;

    this.log(`[ProfileManager] Profile ${profileId} launched (usage: ${instance.usageCount}, daily: ${instance.dailyCount}/${this.config.maxDailyRequests})`);

    return instance;
  }

  /**
   * 다음 프로필 가져오기 (라운드 로빈)
   */
  async getNextProfile(): Promise<ProfileInstance> {
    // 사용 가능한 프로필 찾기
    for (let attempt = 0; attempt < this.config.profileCount; attempt++) {
      const profileId = (this.currentIndex % this.config.profileCount) + 1;
      this.currentIndex++;

      const instance = this.profiles.get(profileId);
      if (!instance) continue;

      // 블랙리스트 확인
      if (instance.blacklisted) {
        this.log(`[ProfileManager] Skipping blacklisted profile ${profileId}`);
        continue;
      }

      // 일일 리셋 확인
      this.checkDailyReset(instance);

      // 일일 제한 확인
      if (instance.dailyCount >= this.config.maxDailyRequests) {
        this.log(`[ProfileManager] Skipping profile ${profileId} (daily limit reached)`);
        continue;
      }

      // 쿨다운 확인
      const timeSinceLastUse = Date.now() - instance.lastUsed;
      if (timeSinceLastUse < this.config.cooldownMs && instance.lastUsed > 0) {
        this.log(`[ProfileManager] Skipping profile ${profileId} (cooldown: ${Math.ceil((this.config.cooldownMs - timeSinceLastUse) / 1000)}s remaining)`);
        continue;
      }

      // 프로필 시작
      return await this.launchProfile(profileId);
    }

    throw new Error("No available profiles (all blacklisted, at daily limit, or in cooldown)");
  }

  /**
   * 프로필 해제 (사용 완료)
   */
  async releaseProfile(profileId: number, keepOpen: boolean = false): Promise<void> {
    const instance = this.profiles.get(profileId);
    if (!instance) return;

    instance.inUse = false;
    instance.lastUsed = Date.now();

    if (!keepOpen && instance.context) {
      this.log(`[ProfileManager] Closing profile ${profileId}`);
      await instance.context.close().catch(() => {});
      instance.context = null;
      instance.page = null;
    } else {
      this.log(`[ProfileManager] Released profile ${profileId} (kept open)`);
    }
  }

  /**
   * 모든 프로필 종료
   */
  async closeAllProfiles(): Promise<void> {
    this.log("[ProfileManager] Closing all profiles");

    for (const [profileId, instance] of this.profiles) {
      if (instance.context) {
        await instance.context.close().catch(() => {});
        instance.context = null;
        instance.page = null;
      }
      instance.inUse = false;
    }

    this.log("[ProfileManager] All profiles closed");
  }

  /**
   * 프로필 블랙리스트 (차단 감지 시)
   */
  blacklistProfile(profileId: number): void {
    const instance = this.profiles.get(profileId);
    if (instance) {
      instance.blacklisted = true;
      this.log(`[ProfileManager] Profile ${profileId} blacklisted`);
    }
  }

  /**
   * 프로필 상태 조회
   */
  getProfileStats(): ProfileStats[] {
    const stats: ProfileStats[] = [];

    for (const [profileId, instance] of this.profiles) {
      this.checkDailyReset(instance);

      stats.push({
        profileId,
        totalRequests: instance.usageCount,
        dailyRequests: instance.dailyCount,
        successCount: 0,  // 외부에서 추적
        failCount: 0,     // 외부에서 추적
        blocked: instance.blacklisted,
        lastUsed: instance.lastUsed > 0
          ? new Date(instance.lastUsed).toISOString()
          : "never",
      });
    }

    return stats;
  }

  /**
   * 사용 가능한 프로필 수
   */
  getAvailableCount(): number {
    let count = 0;

    for (const instance of this.profiles.values()) {
      this.checkDailyReset(instance);

      if (!instance.blacklisted && instance.dailyCount < this.config.maxDailyRequests) {
        count++;
      }
    }

    return count;
  }

  /**
   * 프로필 인스턴스 가져오기
   */
  getProfile(profileId: number): ProfileInstance | undefined {
    return this.profiles.get(profileId);
  }

  /**
   * 일일 리셋 확인
   */
  private checkDailyReset(instance: ProfileInstance): void {
    const todayReset = this.getTodayReset();
    if (instance.dailyReset < todayReset) {
      instance.dailyCount = 0;
      instance.dailyReset = todayReset;
      this.log(`[ProfileManager] Profile ${instance.id} daily count reset`);
    }
  }

  /**
   * 오늘 자정 타임스탬프
   */
  private getTodayReset(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }

  /**
   * 설정 가져오기
   */
  getConfig(): ProfileConfig {
    return { ...this.config };
  }
}
