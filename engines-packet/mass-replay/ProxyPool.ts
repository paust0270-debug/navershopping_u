/**
 * Proxy Pool - 프록시 관리 및 로테이션
 *
 * 지원 프록시 유형:
 * 1. Residential (주거용) - 가장 자연스러움
 * 2. Mobile (모바일) - LTE/5G
 * 3. Datacenter - 빠르지만 탐지 위험
 */

// ============================================================
//  타입 정의
// ============================================================

export interface ProxyInfo {
  host: string;
  port: number;
  username?: string;
  password?: string;
  type: "http" | "https" | "socks5";
  category: "residential" | "mobile" | "datacenter";
  country?: string;
  region?: string;

  // 통계
  successCount?: number;
  failCount?: number;
  avgLatencyMs?: number;
  lastUsed?: number;
}

export interface ProxyPoolConfig {
  // 로테이션 전략
  strategy: "round-robin" | "random" | "least-used" | "performance";

  // 헬스 체크
  healthCheckEnabled: boolean;
  healthCheckIntervalMs: number;
  maxFailCount: number;  // 이 횟수 초과 시 풀에서 제외

  // 속도 제한
  minDelayBetweenUsesMs: number;  // 같은 프록시 재사용 최소 간격
}

// ============================================================
//  ProxyPool 클래스
// ============================================================

export class ProxyPool {
  private proxies: ProxyInfo[];
  private activeProxies: ProxyInfo[];
  private blacklist: Set<string>;
  private currentIndex: number = 0;
  private usageMap: Map<string, { lastUsed: number; count: number }>;
  private config: ProxyPoolConfig;

  constructor(
    proxies: ProxyInfo[],
    config: Partial<ProxyPoolConfig> = {}
  ) {
    this.config = {
      strategy: "round-robin",
      healthCheckEnabled: false,
      healthCheckIntervalMs: 60000,
      maxFailCount: 5,
      minDelayBetweenUsesMs: 1000,
      ...config,
    };

    this.proxies = proxies.map(p => ({
      ...p,
      successCount: 0,
      failCount: 0,
      avgLatencyMs: 0,
    }));
    this.activeProxies = [...this.proxies];
    this.blacklist = new Set();
    this.usageMap = new Map();

    if (this.config.healthCheckEnabled) {
      this.startHealthCheck();
    }
  }

  /**
   * 다음 프록시 가져오기
   */
  getNext(): ProxyInfo {
    if (this.activeProxies.length === 0) {
      throw new Error("No active proxies available");
    }

    let proxy: ProxyInfo;

    switch (this.config.strategy) {
      case "round-robin":
        proxy = this.getRoundRobin();
        break;
      case "random":
        proxy = this.getRandom();
        break;
      case "least-used":
        proxy = this.getLeastUsed();
        break;
      case "performance":
        proxy = this.getBestPerformance();
        break;
      default:
        proxy = this.getRoundRobin();
    }

    // 사용 기록 업데이트
    const key = this.getProxyKey(proxy);
    this.usageMap.set(key, {
      lastUsed: Date.now(),
      count: (this.usageMap.get(key)?.count || 0) + 1,
    });

    return proxy;
  }

  /**
   * 프록시 URL 생성
   */
  getProxyUrl(proxy: ProxyInfo): string {
    const auth = proxy.username && proxy.password
      ? `${proxy.username}:${proxy.password}@`
      : "";

    return `${proxy.type}://${auth}${proxy.host}:${proxy.port}`;
  }

  /**
   * 성공 보고
   */
  reportSuccess(proxy: ProxyInfo, latencyMs: number): void {
    const p = this.findProxy(proxy);
    if (p) {
      p.successCount = (p.successCount || 0) + 1;
      // 이동 평균 latency 계산
      const totalRequests = (p.successCount || 0) + (p.failCount || 0);
      p.avgLatencyMs = ((p.avgLatencyMs || 0) * (totalRequests - 1) + latencyMs) / totalRequests;
    }
  }

  /**
   * 실패 보고
   */
  reportFailure(proxy: ProxyInfo): void {
    const p = this.findProxy(proxy);
    if (p) {
      p.failCount = (p.failCount || 0) + 1;

      // 실패 횟수 초과 시 블랙리스트
      if (p.failCount >= this.config.maxFailCount) {
        this.blacklistProxy(proxy);
      }
    }
  }

  /**
   * 프록시 블랙리스트 추가
   */
  blacklistProxy(proxy: ProxyInfo): void {
    const key = this.getProxyKey(proxy);
    this.blacklist.add(key);
    this.activeProxies = this.activeProxies.filter(
      p => this.getProxyKey(p) !== key
    );
    console.log(`[ProxyPool] Blacklisted: ${proxy.host}:${proxy.port}`);
  }

  /**
   * 활성 프록시 수
   */
  getActiveCount(): number {
    return this.activeProxies.length;
  }

  /**
   * 통계
   */
  getStats(): {
    total: number;
    active: number;
    blacklisted: number;
    byCategory: Record<string, number>;
  } {
    const byCategory: Record<string, number> = {};
    for (const p of this.activeProxies) {
      byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    }

    return {
      total: this.proxies.length,
      active: this.activeProxies.length,
      blacklisted: this.blacklist.size,
      byCategory,
    };
  }

  // ============================================================
  //  프록시 선택 전략
  // ============================================================

  private getRoundRobin(): ProxyInfo {
    const proxy = this.activeProxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.activeProxies.length;
    return proxy;
  }

  private getRandom(): ProxyInfo {
    const index = Math.floor(Math.random() * this.activeProxies.length);
    return this.activeProxies[index];
  }

  private getLeastUsed(): ProxyInfo {
    return this.activeProxies.reduce((least, current) => {
      const leastCount = this.usageMap.get(this.getProxyKey(least))?.count || 0;
      const currentCount = this.usageMap.get(this.getProxyKey(current))?.count || 0;
      return currentCount < leastCount ? current : least;
    });
  }

  private getBestPerformance(): ProxyInfo {
    // 성공률 * (1 / latency) 기준 정렬
    const scored = this.activeProxies.map(p => {
      const total = (p.successCount || 0) + (p.failCount || 0);
      const successRate = total > 0 ? (p.successCount || 0) / total : 0.5;
      const latencyScore = p.avgLatencyMs ? 1000 / p.avgLatencyMs : 1;
      return { proxy: p, score: successRate * latencyScore };
    });

    scored.sort((a, b) => b.score - a.score);

    // 상위 30% 중에서 랜덤 선택 (다양성 유지)
    const topCount = Math.max(1, Math.floor(scored.length * 0.3));
    const topProxies = scored.slice(0, topCount);
    return topProxies[Math.floor(Math.random() * topProxies.length)].proxy;
  }

  // ============================================================
  //  헬퍼 메서드
  // ============================================================

  private getProxyKey(proxy: ProxyInfo): string {
    return `${proxy.host}:${proxy.port}`;
  }

  private findProxy(proxy: ProxyInfo): ProxyInfo | undefined {
    const key = this.getProxyKey(proxy);
    return this.proxies.find(p => this.getProxyKey(p) === key);
  }

  private startHealthCheck(): void {
    setInterval(async () => {
      for (const proxy of this.activeProxies) {
        try {
          const start = Date.now();
          // 간단한 연결 테스트 (실제 구현에서는 HTTP 요청)
          // await this.testProxy(proxy);
          const latency = Date.now() - start;
          this.reportSuccess(proxy, latency);
        } catch {
          this.reportFailure(proxy);
        }
      }
    }, this.config.healthCheckIntervalMs);
  }
}

// ============================================================
//  프록시 목록 로더
// ============================================================

export function loadProxiesFromEnv(): ProxyInfo[] {
  const proxyList = process.env.PROXY_LIST || "";
  if (!proxyList) return [];

  return proxyList.split(",").map(proxyStr => {
    // 형식: type://user:pass@host:port
    const match = proxyStr.match(/^(http|https|socks5):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/);
    if (!match) {
      console.warn(`Invalid proxy format: ${proxyStr}`);
      return null;
    }

    const [, type, username, password, host, port] = match;
    return {
      host,
      port: parseInt(port),
      username,
      password,
      type: type as "http" | "https" | "socks5",
      category: "residential" as const,  // 기본값
    };
  }).filter(Boolean) as ProxyInfo[];
}

export default ProxyPool;
