/**
 * Mass Replay Module - 대량 패킷 리플레이
 *
 * 사용법:
 * ```typescript
 * import { MassReplayEngine, loadProxiesFromEnv } from "./mass-replay";
 *
 * const engine = new MassReplayEngine({
 *   concurrency: 50,
 *   maxRequestsPerSecond: 100,
 *   proxyPool: loadProxiesFromEnv(),
 * });
 *
 * const results = await engine.execute(tasks);
 * ```
 */

export { MassReplayEngine, type MassReplayConfig, type ReplayTask, type ReplayResult } from "./MassReplayEngine";
export { IdentityGenerator, type UserIdentity } from "./IdentityGenerator";
export { ProxyPool, loadProxiesFromEnv, type ProxyInfo, type ProxyPoolConfig } from "./ProxyPool";
export { RequestBuilder } from "./RequestBuilder";
export {
  ProfileManager,
  type ProfileConfig,
  type ProfileDevice,
  type ProfileInstance,
  type ProfileStats,
} from "./ProfileManager";
export {
  BatchScheduler,
  type BatchConfig,
  type SubBatch,
  type BatchResult,
  type ScheduleSummary,
} from "./BatchScheduler";
