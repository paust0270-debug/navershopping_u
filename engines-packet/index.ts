/**
 * Packet Engine - Main Export
 *
 * 네트워크 로그 기반 패킷 엔진
 * Patchright + HTTP 하이브리드 방식으로 요청 리플레이
 */

// Types
export * from "./types";

// Analysis modules
export { HarConverter } from "./analysis/HarConverter";
export { PatternAnalyzer } from "./analysis/PatternAnalyzer";
export { TimingAnalyzer } from "./analysis/TimingAnalyzer";
export {
  TLSConsistencyChecker,
  CookieContinuityChecker,
  ALPNChecker,
  TimingDeviationAnalyzer,
  HeaderEntropyAnalyzer,
  ValidationRunner,
} from "./analysis/Validators";

// Session modules
export { SessionManager } from "./session/SessionManager";
export { HeaderBuilder } from "./session/HeaderBuilder";
export { CookieExtractor } from "./session/CookieExtractor";
export { DeviceIdGenerator } from "./session/DeviceIdGenerator";

// Replay modules
export { RequestReplayer } from "./replay/RequestReplayer";
export { BrowserFetch } from "./replay/BrowserFetch";  // Chrome TLS 보장
export { TimingSimulator } from "./replay/TimingSimulator";
export { RequestQueue } from "./replay/RequestQueue";

// Hybrid modules
export { HybridContext } from "./hybrid/HybridContext";
export { BrowserSync } from "./hybrid/BrowserSync";

// Main engine
export { PacketEngine } from "./PacketEngine";

// Verification modules (실전 검증 도구)
export {
  TLSVerifier,
  NaverLogMonitor,
  CookieChainVerifier,
  RealWorldTestRunner,
  runVerification,
} from "./verification";

// Default config
export const defaultReplayConfig = {
  preserveTiming: true,
  timingMultiplier: 1.0,
  parallelRequests: true,
  maxConcurrency: 6,
  retryCount: 2,
  retryDelay: 1000,
  skipPatterns: [
    ".*\\.(png|jpg|jpeg|gif|webp|svg|ico)$",
    ".*\\.(css|woff|woff2|ttf|eot)$",
    ".*/nlog\\.naver\\.com/.*",
    ".*/er\\.search\\.naver\\.com/.*",
  ],
  criticalPatterns: [
    ".*/www\\.naver\\.com/?$",
    ".*/nam\\.veta\\.naver\\.com/nac/.*",
    ".*/shopsquare\\.naver\\.com/api/auth.*",
    ".*/search\\.naver\\.com/search\\.naver.*",
  ],
  timeout: 30000,
};

export const defaultHybridConfig = {
  headless: false,
  browserTimeout: 30000,
  httpTimeout: 10000,
  captchaSolverEnabled: true,
  maxCaptchaRetries: 2,
};

export const defaultPacketEngineConfig = {
  headless: false,
  replayConfig: defaultReplayConfig,
  hybridConfig: defaultHybridConfig,
  logNetwork: true,
};
