/**
 * engine-config.json 로드 및 런타임 옵션
 */
import * as path from "path";
import * as fs from "fs";

export type SearchFlowVersion = "A" | "B" | "C" | "D" | "E" | "F";

export interface EngineConfigFile {
  delays?: Record<string, number | { min: number; max: number }>;
  workMode?: "mobile" | "desktop" | "random";
  userAgents?: { desktop?: string[]; mobile?: string[] };
  proxy?: {
    enabled?: boolean;
    rotatePerTask?: boolean;
    entries?: Array<{ server: string; username?: string; password?: string }>;
  };
  search?: {
    maxScrollAttempts?: number;
    explorationScrollPixels?: number;
    keywordBlacklistEnabled?: boolean;
    keywordBlacklistFile?: string;
    /** A=통합검색 1차+2차 조합(기본), B=통합검색 메인키워드만, C=통합검색 2차만, D=통합검색 순위체크, E=통합검색 ackey 위장, F=통합검색 상품명 전체 */
    searchFlowVersion?: SearchFlowVersion;
  };
  airplaneMode?: { toggleBeforeEachTask?: boolean; offOnCycles?: number };
  logging?: { engineEvents?: boolean };
  scheduling?: { emptyQueueWaitMs?: number; workerStartDelayMs?: number };
  taskSource?: { taskFilePath?: string; resultFilePath?: string };
  naverLoginEnabled?: boolean;
  anthropicApiKeys?: Array<{ name: string; key: string }>;
  anthropicApiKeyIndex?: number;
  [key: string]: unknown;
}

const CONFIG_CANDIDATES = [
  path.join(process.cwd(), "engine-config.json"),
  path.join(__dirname, "engine-config.json"),
];

const DEFAULT_DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_DELAY_SPECS: Record<string, number | { min: number; max: number }> = {
  browserLaunch: 2000,
  browserLoad: { min: 2500, max: 4000 },
  portalAfterOpen: { min: 1500, max: 2500 },
  searchFakeClickGap: { min: 800, max: 1200 },
  beforeFirstKeyword: { min: 300, max: 500 },
  firstKeywordTypingDelay: { min: 80, max: 150 },
  afterFirstKeywordType: { min: 500, max: 900 },
  afterFirstSearchLoad: { min: 2000, max: 3000 },
  secondSearchField: { min: 300, max: 500 },
  secondKeywordTypingDelay: { min: 80, max: 150 },
  afterSecondKeywordType: { min: 500, max: 800 },
  afterSecondSearchLoad: { min: 2000, max: 3000 },
  afterProductClick: 2000,
  stayOnProduct: { min: 3000, max: 6000 },
  explorationBetweenScrolls: { min: 300, max: 500 },
  proxySetup: 3000,
  taskGapRest: { min: 2000, max: 3000 },
};

export const MOBILE_CONTEXT_OPTIONS = {
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36",
  viewport: { width: 400, height: 700 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  locale: "ko-KR",
  timezoneId: "Asia/Seoul",
  extraHTTPHeaders: {
    "sec-ch-ua": '"Chromium";v="144", "Google Chrome";v="144", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
  },
};

function readConfigJson(): EngineConfigFile {
  for (const p of CONFIG_CANDIDATES) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        return JSON.parse(raw) as EngineConfigFile;
      } catch {
        console.warn(`[EngineConfig] 파싱 실패: ${p}`);
      }
    }
  }
  return {};
}

function delayMs(spec: number | { min: number; max: number } | undefined, fallback: number | { min: number; max: number }): number {
  const s = spec ?? fallback;
  if (typeof s === "number") return Math.max(0, s);
  const min = Math.min(s.min, s.max);
  const max = Math.max(s.min, s.max);
  return min + Math.floor(Math.random() * (max - min + 1));
}

function parseSearchFlowVersion(v: unknown): SearchFlowVersion {
  if (v === "B" || v === "C" || v === "D" || v === "E" || v === "F") return v;
  return "A";
}

function resolveEngineTaskFilePath(file: EngineConfigFile): string {
  if (process.env.ENGINE_TASK_FILE?.trim()) {
    const e = process.env.ENGINE_TASK_FILE.trim();
    return path.isAbsolute(e) ? e : path.join(process.cwd(), e);
  }
  const p = file.taskSource?.taskFilePath?.trim();
  if (p) return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  return path.join(process.cwd(), "engine-next-task.json");
}

function resolveKeywordBlacklistPath(file: EngineConfigFile): string {
  const rel = file.search?.keywordBlacklistFile?.trim();
  const p = rel && rel.length > 0 ? rel : path.join("data", "keyword-blacklist.json");
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

function resolveEngineResultFilePath(file: EngineConfigFile): string {
  if (process.env.ENGINE_RESULT_FILE?.trim()) {
    const r = process.env.ENGINE_RESULT_FILE.trim();
    return path.isAbsolute(r) ? r : path.join(process.cwd(), r);
  }
  const p = file.taskSource?.resultFilePath?.trim();
  if (p) return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  return path.join(process.cwd(), "engine-last-result.json");
}

export interface EngineRuntime {
  file: EngineConfigFile;
  delay: (key: string) => number;
  workMode: "mobile" | "desktop" | "random";
  mobileUserAgents: string[];
  desktopUserAgents: string[];
  proxyEnabled: boolean;
  proxyRotatePerTask: boolean;
  proxyEntries: Array<{ server: string; username?: string; password?: string }>;
  maxScrollAttempts: number;
  explorationScrollPixels: number;
  keywordBlacklistEnabled: boolean;
  keywordBlacklistPath: string;
  searchFlowVersion: SearchFlowVersion;
  airplaneBeforeTask: boolean;
  airplaneCycles: number;
  logEngineEvents: boolean;
  emptyQueueWaitMs: number;
  workerStartDelayMs: number;
  engineTaskFilePath: string;
  engineResultFilePath: string;
  naverLoginEnabled: boolean;
}

export function loadEngineConfig(): EngineRuntime {
  const file = readConfigJson();
  const mergedDelays = { ...DEFAULT_DELAY_SPECS, ...(file.delays || {}) };
  const delay = (key: string) => delayMs(file.delays?.[key], mergedDelays[key] ?? 0);
  const mobileUA = file.userAgents?.mobile?.filter(Boolean) || [];
  const desktopUA = file.userAgents?.desktop?.filter(Boolean) || [];
  return {
    file,
    delay,
    workMode:
      file.workMode === "desktop" || file.workMode === "random" || file.workMode === "mobile" ? file.workMode : "mobile",
    mobileUserAgents: mobileUA.length > 0 ? mobileUA : [MOBILE_CONTEXT_OPTIONS.userAgent],
    desktopUserAgents: desktopUA.length > 0 ? desktopUA : [DEFAULT_DESKTOP_UA],
    proxyEnabled: !!file.proxy?.enabled && (file.proxy?.entries?.length ?? 0) > 0,
    proxyRotatePerTask: file.proxy?.rotatePerTask !== false,
    proxyEntries: file.proxy?.entries || [],
    maxScrollAttempts: Math.max(1, file.search?.maxScrollAttempts ?? 4),
    explorationScrollPixels: Math.max(100, file.search?.explorationScrollPixels ?? 500),
    keywordBlacklistEnabled: file.search?.keywordBlacklistEnabled !== false,
    keywordBlacklistPath: resolveKeywordBlacklistPath(file),
    searchFlowVersion: parseSearchFlowVersion(file.search?.searchFlowVersion),
    /** 설정 생략 시 기본 false (USB 폰 미연결 환경에서 ADB 오류 방지) */
    airplaneBeforeTask: file.airplaneMode?.toggleBeforeEachTask === true,
    airplaneCycles: Math.max(1, file.airplaneMode?.offOnCycles ?? 1),
    logEngineEvents: file.logging?.engineEvents !== false,
    emptyQueueWaitMs: Math.max(1000, file.scheduling?.emptyQueueWaitMs ?? 10000),
    workerStartDelayMs: Math.max(0, file.scheduling?.workerStartDelayMs ?? 3000),
    engineTaskFilePath: resolveEngineTaskFilePath(file),
    engineResultFilePath: resolveEngineResultFilePath(file),
    naverLoginEnabled: file.naverLoginEnabled === true,
  };
}

export function resolveMobileForTask(runtime: EngineRuntime): boolean {
  if (runtime.workMode === "mobile") return true;
  if (runtime.workMode === "desktop") return false;
  return Math.random() < 0.5;
}

export function pickUserAgent(runtime: EngineRuntime, isMobile: boolean): string {
  const list = isMobile ? runtime.mobileUserAgents : runtime.desktopUserAgents;
  return list[Math.floor(Math.random() * list.length)] || DEFAULT_DESKTOP_UA;
}

export function pickProxyConfig(
  runtime: EngineRuntime
): { server: string; username?: string; password?: string } | undefined {
  if (!runtime.proxyEnabled) return undefined;
  const entries = runtime.proxyEntries;
  if (!entries.length) return undefined;
  const e = runtime.proxyRotatePerTask
    ? entries[Math.floor(Math.random() * entries.length)]
    : entries[0];
  return {
    server: e.server,
    ...(e.username ? { username: e.username } : {}),
    ...(e.password ? { password: e.password } : {}),
  };
}

export function buildBrowserContextOptions(isMobile: boolean, userAgent: string) {
  if (isMobile) {
    return {
      ...MOBILE_CONTEXT_OPTIONS,
      userAgent,
    };
  }
  return {
    viewport: { width: 400, height: 700 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    userAgent,
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  };
}
