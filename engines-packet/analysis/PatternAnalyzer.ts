/**
 * Pattern Analyzer
 *
 * 여러 네트워크 로그를 분석하여 요청 패턴 추출
 * - 필수 요청 식별
 * - 의존성 그래프 생성
 * - 타이밍 통계
 */

import * as fs from "fs";
import * as path from "path";
import type {
  NetworkCaptureResult,
  CapturedRequest,
  RequestPattern,
  TimingPattern,
  PatternAnalysisResult,
  LogFunction,
} from "../types";

interface RequestStats {
  url: string;
  method: string;
  resourceType: string;
  count: number;
  timestamps: number[];
  headers: Map<string, Set<string>>;
  postDataSamples: string[];
}

export class PatternAnalyzer {
  private log: LogFunction;
  private captures: NetworkCaptureResult[] = [];
  private requestStats: Map<string, RequestStats> = new Map();

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * 캡처 파일들 로드
   */
  loadFromDirectory(dir: string, filter: "success" | "captcha" | "all" = "success"): void {
    const files = fs.readdirSync(dir).filter((f) => {
      if (!f.endsWith(".json")) return false;
      if (filter === "all") return true;
      return f.startsWith(filter);
    });

    this.log(`[PatternAnalyzer] Loading ${files.length} files from ${dir}`);

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), "utf-8");
        const capture: NetworkCaptureResult = JSON.parse(content);
        this.captures.push(capture);
      } catch (error) {
        this.log(`[PatternAnalyzer] Failed to load ${file}: ${error}`);
      }
    }

    this.log(`[PatternAnalyzer] Loaded ${this.captures.length} captures`);
  }

  /**
   * 여러 캡처 분석
   */
  analyzeMultiple(captures?: NetworkCaptureResult[]): PatternAnalysisResult {
    const toAnalyze = captures || this.captures;

    this.log(`[PatternAnalyzer] Analyzing ${toAnalyze.length} captures`);

    // 요청 통계 수집
    this.requestStats.clear();
    for (const capture of toAnalyze) {
      this.collectStats(capture);
    }

    // 패턴 추출
    const allPatterns = this.extractPatterns(toAnalyze.length);
    const criticalPatterns = allPatterns.filter((p) => p.required);
    const optionalPatterns = allPatterns.filter((p) => !p.required);

    // 의존성 그래프
    const dependencyGraph = this.buildDependencyGraph(allPatterns);

    // 병렬 그룹
    const parallelGroups = this.buildParallelGroups(allPatterns);

    // 타이밍 통계
    const timingStats = this.buildTimingStats();

    return {
      totalCaptures: toAnalyze.length,
      criticalPatterns,
      optionalPatterns,
      dependencyGraph,
      parallelGroups,
      timingStats,
    };
  }

  /**
   * 필수 요청 패턴 가져오기
   */
  getCriticalRequests(): RequestPattern[] {
    const result = this.analyzeMultiple();
    return result.criticalPatterns;
  }

  /**
   * 의존성 그래프 가져오기
   */
  getDependencyGraph(): Map<string, string[]> {
    const result = this.analyzeMultiple();
    return result.dependencyGraph;
  }

  /**
   * URL 패턴별 타이밍 통계
   */
  getTimingStats(urlPattern: string): TimingPattern | undefined {
    const result = this.analyzeMultiple();
    return result.timingStats.get(urlPattern);
  }

  /**
   * 패턴을 파일로 저장
   */
  exportPatterns(outputPath: string): void {
    const result = this.analyzeMultiple();

    const output = {
      totalCaptures: result.totalCaptures,
      criticalPatterns: result.criticalPatterns,
      optionalPatterns: result.optionalPatterns,
      dependencyGraph: Object.fromEntries(result.dependencyGraph),
      parallelGroups: Object.fromEntries(result.parallelGroups),
      timingStats: Object.fromEntries(result.timingStats),
    };

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    this.log(`[PatternAnalyzer] Exported patterns to: ${outputPath}`);
  }

  /**
   * 캡처에서 통계 수집
   */
  private collectStats(capture: NetworkCaptureResult): void {
    for (const request of capture.requests) {
      const key = this.getUrlKey(request.url);
      const existing = this.requestStats.get(key);

      if (existing) {
        existing.count++;
        existing.timestamps.push(request.timestamp);

        // 헤더 수집
        for (const [name, value] of Object.entries(request.headers)) {
          const headerSet = existing.headers.get(name) || new Set();
          headerSet.add(value);
          existing.headers.set(name, headerSet);
        }

        // POST 데이터 샘플
        if (request.postData && existing.postDataSamples.length < 5) {
          existing.postDataSamples.push(request.postData);
        }
      } else {
        const headers = new Map<string, Set<string>>();
        for (const [name, value] of Object.entries(request.headers)) {
          headers.set(name, new Set([value]));
        }

        this.requestStats.set(key, {
          url: request.url,
          method: request.method,
          resourceType: request.resourceType,
          count: 1,
          timestamps: [request.timestamp],
          headers,
          postDataSamples: request.postData ? [request.postData] : [],
        });
      }
    }
  }

  /**
   * URL을 정규화된 키로 변환
   */
  private getUrlKey(url: string): string {
    try {
      const parsed = new URL(url);
      // 쿼리 파라미터 제거하고 호스트+경로만
      return `${parsed.host}${parsed.pathname}`;
    } catch {
      return url;
    }
  }

  /**
   * 패턴 추출
   */
  private extractPatterns(totalCaptures: number): RequestPattern[] {
    const patterns: RequestPattern[] = [];
    const threshold = totalCaptures * 0.8; // 80% 이상 등장하면 필수

    for (const [key, stats] of Array.from(this.requestStats)) {
      // 정적 헤더와 동적 헤더 분리
      const staticHeaders: Record<string, string> = {};
      const dynamicHeaders: string[] = [];

      for (const [name, values] of Array.from(stats.headers)) {
        if (values.size === 1) {
          staticHeaders[name] = Array.from(values)[0];
        } else {
          dynamicHeaders.push(name);
        }
      }

      const timing = this.calculateTimingPattern(stats.timestamps);

      patterns.push({
        id: this.generatePatternId(key),
        urlPattern: this.urlToPattern(key),
        method: stats.method,
        resourceType: stats.resourceType,
        timing,
        dependencies: [], // 나중에 계산
        required: stats.count >= threshold,
        headers: {
          static: staticHeaders,
          dynamic: dynamicHeaders,
        },
        postDataTemplate: stats.postDataSamples[0],
      });
    }

    return patterns;
  }

  /**
   * URL을 RegExp 패턴으로 변환
   */
  private urlToPattern(urlKey: string): string {
    return urlKey
      .replace(/\./g, "\\.")
      .replace(/\//g, "\\/")
      .replace(/\?/g, "\\?");
  }

  /**
   * 패턴 ID 생성
   */
  private generatePatternId(urlKey: string): string {
    // 호스트와 경로에서 ID 생성
    const parts = urlKey.split("/");
    const host = parts[0].replace(/\./g, "_");
    const path = parts.slice(1).join("_").replace(/[^a-zA-Z0-9]/g, "_");
    return `${host}__${path}`.slice(0, 50);
  }

  /**
   * 타이밍 패턴 계산
   */
  private calculateTimingPattern(timestamps: number[]): TimingPattern {
    if (timestamps.length === 0) {
      return {
        minDelay: 0,
        maxDelay: 0,
        avgDelay: 0,
        stdDev: 0,
        distribution: "uniform",
      };
    }

    const sorted = [...timestamps].sort((a, b) => a - b);
    const minDelay = sorted[0];
    const maxDelay = sorted[sorted.length - 1];
    const avgDelay = sorted.reduce((a, b) => a + b, 0) / sorted.length;

    // 표준편차
    const variance =
      sorted.reduce((sum, t) => sum + Math.pow(t - avgDelay, 2), 0) /
      sorted.length;
    const stdDev = Math.sqrt(variance);

    // 분포 추정 (간단한 휴리스틱)
    const distribution =
      stdDev < avgDelay * 0.1
        ? "uniform"
        : stdDev < avgDelay * 0.3
          ? "normal"
          : "exponential";

    return { minDelay, maxDelay, avgDelay, stdDev, distribution };
  }

  /**
   * 의존성 그래프 생성
   */
  private buildDependencyGraph(patterns: RequestPattern[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    // 타이밍 기반 의존성 추론
    const sortedByTiming = [...patterns].sort(
      (a, b) => a.timing.avgDelay - b.timing.avgDelay
    );

    for (let i = 0; i < sortedByTiming.length; i++) {
      const current = sortedByTiming[i];
      const dependencies: string[] = [];

      // 이전 패턴들 중 타이밍 차이가 큰 것들을 의존성으로 추가
      for (let j = 0; j < i; j++) {
        const prev = sortedByTiming[j];
        if (current.timing.avgDelay - prev.timing.avgDelay > 100) {
          // 100ms 이상 차이나면 의존성 있을 수 있음
          if (prev.required) {
            dependencies.push(prev.id);
          }
        }
      }

      graph.set(current.id, dependencies);
    }

    return graph;
  }

  /**
   * 병렬 실행 그룹 생성
   */
  private buildParallelGroups(patterns: RequestPattern[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();

    // 비슷한 타이밍의 패턴들을 그룹화 (50ms 이내)
    const sorted = [...patterns].sort(
      (a, b) => a.timing.avgDelay - b.timing.avgDelay
    );

    let groupId = 0;
    let currentGroup: string[] = [];
    let groupStart = 0;

    for (const pattern of sorted) {
      if (currentGroup.length === 0) {
        currentGroup.push(pattern.id);
        groupStart = pattern.timing.avgDelay;
      } else if (pattern.timing.avgDelay - groupStart < 50) {
        currentGroup.push(pattern.id);
      } else {
        if (currentGroup.length > 1) {
          groups.set(`group_${groupId}`, currentGroup);
          groupId++;
        }
        currentGroup = [pattern.id];
        groupStart = pattern.timing.avgDelay;
      }
    }

    if (currentGroup.length > 1) {
      groups.set(`group_${groupId}`, currentGroup);
    }

    return groups;
  }

  /**
   * 타이밍 통계 맵 생성
   */
  private buildTimingStats(): Map<string, TimingPattern> {
    const stats = new Map<string, TimingPattern>();

    for (const [key, reqStats] of Array.from(this.requestStats)) {
      stats.set(key, this.calculateTimingPattern(reqStats.timestamps));
    }

    return stats;
  }
}
