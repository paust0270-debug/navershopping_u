/**
 * Identity Generator - 각 요청마다 다른 사용자 신원 생성
 *
 * 생성 요소:
 * 1. User-Agent (브라우저/OS 조합)
 * 2. Device ID (고유 식별자)
 * 3. Screen Resolution
 * 4. Language/Timezone
 * 5. 기타 핑거프린트
 */

// ============================================================
//  타입 정의
// ============================================================

export interface UserIdentity {
  // 기본 정보
  userAgent: string;
  deviceId: string;
  fwb: string;  // 네이버 fingerprint
  nac: string;  // 네이버 account code

  // 디바이스
  platform: string;
  screenResolution: string;
  viewportSize: string;
  colorDepth: number;
  devicePixelRatio: number;
  hardwareConcurrency: number;
  deviceMemory: number;

  // 언어/지역
  language: string;
  languages: string[];
  timezone: string;

  // 네트워크
  connectionType: string;

  // 타임스탬프
  sessionStartTime: number;
}

// ============================================================
//  데이터 풀 (다양성 확보)
// ============================================================

const USER_AGENT_POOL = {
  windows: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  ],
  mac: [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  ],
  mobile: [
    "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  ],
};

const SCREEN_RESOLUTIONS = {
  desktop: [
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1680, height: 1050 },
    { width: 1280, height: 720 },
    { width: 1600, height: 900 },
  ],
  mobile: [
    { width: 393, height: 873 },   // Galaxy S24
    { width: 412, height: 915 },   // Pixel 8
    { width: 390, height: 844 },   // iPhone 14
    { width: 428, height: 926 },   // iPhone 14 Plus
    { width: 375, height: 812 },   // iPhone X
    { width: 360, height: 800 },   // Common Android
  ],
};

const VIEWPORT_OFFSETS = {
  desktop: [
    { wOffset: 0, hOffset: -80 },   // 탭바 등
    { wOffset: -15, hOffset: -100 },
    { wOffset: 0, hOffset: -120 },
  ],
  mobile: [
    { wOffset: 0, hOffset: -50 },
    { wOffset: 0, hOffset: -60 },
  ],
};

const HARDWARE_PROFILES = {
  high: { cores: 16, memory: 32 },
  medium: { cores: 8, memory: 16 },
  low: { cores: 4, memory: 8 },
  mobile: { cores: 8, memory: 8 },
};

// ============================================================
//  IdentityGenerator 클래스
// ============================================================

export class IdentityGenerator {
  private usedDeviceIds: Set<string> = new Set();
  private deviceType: "desktop" | "mobile";
  private osDistribution: { windows: number; mac: number; mobile: number };

  constructor(options: {
    deviceType?: "desktop" | "mobile" | "mixed";
    osDistribution?: { windows: number; mac: number; mobile: number };
  } = {}) {
    this.deviceType = options.deviceType === "mobile" ? "mobile" : "desktop";
    this.osDistribution = options.osDistribution || {
      windows: 0.7,  // 70% Windows
      mac: 0.2,      // 20% Mac
      mobile: 0.1,   // 10% Mobile
    };
  }

  /**
   * 새로운 고유 Identity 생성
   */
  generate(): UserIdentity {
    const isMobile = this.shouldBeMobile();
    const os = this.selectOS(isMobile);
    const userAgent = this.selectUserAgent(os);
    const screen = this.selectScreenResolution(isMobile);
    const viewport = this.calculateViewport(screen, isMobile);
    const hardware = this.selectHardwareProfile(isMobile);

    return {
      userAgent,
      deviceId: this.generateDeviceId(),
      fwb: this.generateFwb(),
      nac: this.generateNac(),

      platform: this.getPlatform(os),
      screenResolution: `${screen.width}x${screen.height}`,
      viewportSize: `${viewport.width}x${viewport.height}`,
      colorDepth: 24,
      devicePixelRatio: isMobile ? this.randomChoice([2, 3]) : this.randomChoice([1, 1.25, 1.5, 2]),
      hardwareConcurrency: hardware.cores,
      deviceMemory: hardware.memory,

      language: "ko-KR",
      languages: ["ko-KR", "ko", "en-US", "en"],
      timezone: "Asia/Seoul",

      connectionType: isMobile ? this.randomChoice(["4g", "wifi"]) : "ethernet",

      sessionStartTime: Date.now() - Math.floor(Math.random() * 300000), // 0~5분 전 시작
    };
  }

  /**
   * Device ID 생성 (고유)
   */
  private generateDeviceId(): string {
    let id: string;
    do {
      id = this.randomHex(16);
    } while (this.usedDeviceIds.has(id));

    this.usedDeviceIds.add(id);

    // 메모리 관리: 10000개 초과 시 오래된 것 제거
    if (this.usedDeviceIds.size > 10000) {
      const arr = Array.from(this.usedDeviceIds);
      this.usedDeviceIds = new Set(arr.slice(-5000));
    }

    return id;
  }

  /**
   * 네이버 fwb (fingerprint) 생성
   * 형식: {random}.{timestamp}
   */
  private generateFwb(): string {
    const random = this.randomAlphanumeric(20);
    const timestamp = Date.now() - Math.floor(Math.random() * 86400000); // 최근 24시간
    return `${random}.${timestamp}`;
  }

  /**
   * 네이버 nac 생성
   */
  private generateNac(): string {
    return this.randomAlphanumeric(12);
  }

  // ============================================================
  //  헬퍼 메서드
  // ============================================================

  private shouldBeMobile(): boolean {
    return Math.random() < this.osDistribution.mobile;
  }

  private selectOS(isMobile: boolean): "windows" | "mac" | "mobile" {
    if (isMobile) return "mobile";

    const rand = Math.random();
    const adjustedWindows = this.osDistribution.windows / (this.osDistribution.windows + this.osDistribution.mac);

    return rand < adjustedWindows ? "windows" : "mac";
  }

  private selectUserAgent(os: "windows" | "mac" | "mobile"): string {
    const pool = USER_AGENT_POOL[os];
    return this.randomChoice(pool);
  }

  private selectScreenResolution(isMobile: boolean): { width: number; height: number } {
    const pool = isMobile ? SCREEN_RESOLUTIONS.mobile : SCREEN_RESOLUTIONS.desktop;
    return this.randomChoice(pool);
  }

  private calculateViewport(
    screen: { width: number; height: number },
    isMobile: boolean
  ): { width: number; height: number } {
    const offsets = isMobile ? VIEWPORT_OFFSETS.mobile : VIEWPORT_OFFSETS.desktop;
    const offset = this.randomChoice(offsets);

    return {
      width: screen.width + offset.wOffset,
      height: screen.height + offset.hOffset,
    };
  }

  private selectHardwareProfile(isMobile: boolean): { cores: number; memory: number } {
    if (isMobile) return HARDWARE_PROFILES.mobile;

    const rand = Math.random();
    if (rand < 0.2) return HARDWARE_PROFILES.high;
    if (rand < 0.7) return HARDWARE_PROFILES.medium;
    return HARDWARE_PROFILES.low;
  }

  private getPlatform(os: "windows" | "mac" | "mobile"): string {
    switch (os) {
      case "windows":
        return "Win32";
      case "mac":
        return "MacIntel";
      case "mobile":
        return "Linux armv8l";
    }
  }

  private randomChoice<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  private randomHex(length: number): string {
    const chars = "0123456789abcdef";
    return Array.from({ length }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  }

  private randomAlphanumeric(length: number): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  }
}

export default IdentityGenerator;
