/**
 * Packet Engine Types
 *
 * 네트워크 로그 기반 패킷 엔진 타입 정의
 */

// 기존 공통 타입 재사용
export type { Product, Profile, Behavior, RunContext, EngineResult } from "../runner/types";
import type { EngineResult } from "../runner/types";

// ========================================
// Network Capture Types (from networkCapture.ts)
// ========================================

export interface CapturedRequest {
  timestamp: number;
  url: string;
  method: string;
  resourceType: string;
  headers: Record<string, string>;
  postData?: string;
}

export interface CapturedResponse {
  timestamp: number;
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  fromCache: boolean;
}

export interface NetworkCaptureResult {
  scenario: "captcha" | "success" | "unknown";
  startTime: number;
  endTime: number;
  requests: CapturedRequest[];
  responses: CapturedResponse[];
  finalUrl: string;
}

// ========================================
// HAR Format Types
// ========================================

export interface HarNameValue {
  name: string;
  value: string;
}

export interface HarPostData {
  mimeType: string;
  text: string;
  params?: HarNameValue[];
}

export interface HarContent {
  size: number;
  mimeType: string;
  text?: string;
  encoding?: string;
}

export interface HarTimings {
  blocked: number;
  dns: number;
  connect: number;
  ssl: number;
  send: number;
  wait: number;
  receive: number;
}

export interface HarRequest {
  method: string;
  url: string;
  httpVersion: string;
  headers: HarNameValue[];
  queryString: HarNameValue[];
  cookies: HarNameValue[];
  headersSize: number;
  bodySize: number;
  postData?: HarPostData;
}

export interface HarResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: HarNameValue[];
  cookies: HarNameValue[];
  content: HarContent;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  cache: Record<string, unknown>;
  timings: HarTimings;
  serverIPAddress?: string;
  connection?: string;
}

export interface HarLog {
  version: string;
  creator: {
    name: string;
    version: string;
  };
  entries: HarEntry[];
}

export interface HarFile {
  log: HarLog;
}

// ========================================
// Pattern Analysis Types
// ========================================

export type TimingDistribution = "uniform" | "normal" | "exponential";

export interface TimingPattern {
  minDelay: number;
  maxDelay: number;
  avgDelay: number;
  stdDev: number;
  distribution: TimingDistribution;
}

export interface RequestPattern {
  id: string;
  urlPattern: string;  // RegExp string
  method: string;
  resourceType: string;
  timing: TimingPattern;
  dependencies: string[];  // Pattern IDs that must complete first
  required: boolean;
  parallelGroup?: string;  // Requests in same group can run in parallel
  headers: {
    static: Record<string, string>;    // Fixed headers
    dynamic: string[];                  // Headers that need runtime generation
  };
  postDataTemplate?: string;  // Template for POST body
}

export interface PatternAnalysisResult {
  totalCaptures: number;
  criticalPatterns: RequestPattern[];
  optionalPatterns: RequestPattern[];
  dependencyGraph: Map<string, string[]>;
  parallelGroups: Map<string, string[]>;
  timingStats: Map<string, TimingPattern>;
}

// ========================================
// Session Management Types
// ========================================

export interface CookieData {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface SessionState {
  cookies: CookieData[];
  headers: Record<string, string>;
  nacToken?: string;       // nam.veta.naver.com NAC token
  authToken?: string;      // GraphQL auth token
  sessionId?: string;      // Browser session ID
  userAgent: string;
  timestamp: number;
}

// ========================================
// Replay Configuration Types
// ========================================

export interface ReplayConfig {
  preserveTiming: boolean;
  timingMultiplier: number;     // 0.5 = 2x speed, 2.0 = half speed
  parallelRequests: boolean;
  maxConcurrency: number;
  retryCount: number;
  retryDelay: number;
  skipPatterns: string[];       // RegExp strings for URLs to skip
  criticalPatterns: string[];   // RegExp strings for URLs that must succeed
  timeout: number;              // Request timeout in ms
}

export interface ReplayRequest {
  id: string;
  pattern: RequestPattern;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  scheduledTime: number;  // Relative timestamp
}

export interface ReplayResponse {
  requestId: string;
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
  duration: number;
  success: boolean;
  error?: string;
}

export interface ReplayResult {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: ReplayResponse[];
  duration: number;
  sessionState: SessionState;
}

// ========================================
// Hybrid Context Types
// ========================================

export type ExecutionPhase = "browser" | "http" | "verify";

export interface HybridConfig {
  headless: boolean;
  browserTimeout: number;
  httpTimeout: number;
  captchaSolverEnabled: boolean;
  maxCaptchaRetries: number;
}

export interface PhaseResult {
  phase: ExecutionPhase;
  success: boolean;
  duration: number;
  error?: string;
  data?: Record<string, unknown>;
}

// ========================================
// Packet Engine Types
// ========================================

export interface PacketEngineConfig {
  headless: boolean;
  replayConfig: ReplayConfig;
  hybridConfig: HybridConfig;
  patternsPath?: string;
  logNetwork: boolean;
}

export interface PacketEngineResult extends EngineResult {
  requestCount: number;
  failedRequests: string[];
  sessionValid: boolean;
  replayDuration: number;
  phases: PhaseResult[];
}

// ========================================
// Utility Types
// ========================================

export type LogFunction = (event: string, data?: unknown) => void;

export interface RequestQueueItem {
  request: ReplayRequest;
  priority: number;
  dependencies: string[];
  status: "pending" | "running" | "completed" | "failed";
  result?: ReplayResponse;
}

// ========================================
// Enhanced Cookie Types (Set-Cookie Parsing)
// ========================================

export interface ParsedSetCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  priority?: "Low" | "Medium" | "High";
}

export interface CookieJarOptions {
  autoExpire: boolean;
  respectHttpOnly: boolean;
  respectSameSite: boolean;
}

// ========================================
// Client Hints Types
// ========================================

export interface ClientHintsConfig {
  browserName: string;
  browserVersion: string;
  platformName: string;
  platformVersion: string;
  architecture: string;
  bitness: string;
  mobile: boolean;
  model?: string;
  wow64: boolean;
}

export interface GeneratedClientHints {
  "sec-ch-ua": string;
  "sec-ch-ua-mobile": string;
  "sec-ch-ua-platform": string;
  "sec-ch-ua-full-version-list"?: string;
  "sec-ch-ua-arch"?: string;
  "sec-ch-ua-bitness"?: string;
  "sec-ch-ua-model"?: string;
  "sec-ch-ua-wow64"?: string;
}

// ========================================
// Patchright Request Types
// ========================================

export interface PatchrightRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  data?: string | Buffer | object;
  form?: Record<string, string | number | boolean>;
  multipart?: Record<string, unknown>;
  timeout?: number;
  failOnStatusCode?: boolean;
  ignoreHTTPSErrors?: boolean;
  maxRedirects?: number;
}

export interface PatchrightResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: () => Promise<Buffer>;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
  ok: boolean;
}

// ========================================
// Validator Types
// ========================================

export type ValidatorStatus = "pass" | "fail" | "warning";

export interface ValidatorResult {
  name: string;
  status: ValidatorStatus;
  score: number;  // 0-100
  details: string[];
  risks: string[];
  recommendations: string[];
}

export interface TLSCheckResult extends ValidatorResult {
  tlsVersion?: string;
  cipherSuite?: string;
  alpnProtocol?: string;
  fingerprint?: string;
}

export interface CookieCheckResult extends ValidatorResult {
  totalCookies: number;
  expiredCookies: number;
  missingCookies: string[];
  inconsistentCookies: string[];
}

export interface HeaderCheckResult extends ValidatorResult {
  entropy: number;
  missingHeaders: string[];
  inconsistentHeaders: string[];
  suspiciousHeaders: string[];
}

export interface TimingCheckResult extends ValidatorResult {
  avgDeviation: number;
  maxDeviation: number;
  outliers: number;
  distributionMatch: boolean;
}

export interface ValidationReport {
  timestamp: number;
  overallStatus: ValidatorStatus;
  overallScore: number;
  results: {
    tls?: TLSCheckResult;
    cookie?: CookieCheckResult;
    header?: HeaderCheckResult;
    timing?: TimingCheckResult;
    alpn?: ValidatorResult;
  };
  summary: string;
}

// ========================================
// Device ID Types
// ========================================

export interface DeviceIdentifiers {
  deviceId: string;
  pageUid: string;
  sessionId: string;
  timestamp: number;
}

export interface NaverApiParams {
  deviceId: string;
  page_uid: string;
  ts: string;
  nvMid?: string;
  sid?: string;
}

// ========================================
// Behavior Log Types (행동 로그)
// ========================================

export type BehaviorLogType =
  | "viewProduct"
  | "scroll"
  | "dwellStart"
  | "dwellEnd"
  | "expose"
  | "impression"
  | "adExpose"
  | "click";

export interface CapturedBehaviorLog {
  type: BehaviorLogType;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  cookies: string;
  timestamp: number;
}

export interface BehaviorLogTemplate {
  type: BehaviorLogType;
  url: string;
  method: string;
  staticHeaders: Record<string, string>;
  dynamicHeaders: string[];  // Header names that need runtime generation
  bodyTemplate: Record<string, unknown>;
  dynamicFields: string[];   // Body fields that need runtime generation
}

export interface ViewProductParams {
  nvMid: string;
  page_uid: string;
  timestamp: number;
  referrer?: string;
  nclick?: string;
}

export interface ScrollLogParams {
  page_uid: string;
  depth: number;       // 0-100%
  timestamp: number;
}

export interface DwellLogParams {
  page_uid: string;
  dwellTime: number;   // milliseconds
  timestamp: number;
}

// ========================================
// Multi-Send Engine Types
// ========================================

export interface MultiSendConfig {
  count: number;
  minDelay: number;    // ms between requests
  maxDelay: number;
  jitterPercent: number;  // 0-100
  preserveOrder: boolean;
  failFast: boolean;   // Stop on first error
}

export interface MultiSendResult {
  total: number;
  success: number;
  failed: number;
  duration: number;
  errors: string[];
}

export interface BehaviorReplayPlan {
  viewProduct: number;  // Number of viewProduct calls
  scroll: number;       // Number of scroll calls
  dwell: number;        // Number of dwell calls
  expose: number;       // Number of expose calls
}
