/**
 * Timing Analyzer
 *
 * 네트워크 요청 타이밍 분석
 * - 타이밍 분포 분석
 * - 최적 딜레이 계산
 * - 타이밍 시퀀스 생성
 */

import * as fs from "fs";
import * as path from "path";
import type {
  NetworkCaptureResult,
  CapturedRequest,
  TimingPattern,
  TimingDistribution,
  LogFunction,
} from "../types";

interface TimingBucket {
  start: number;
  end: number;
  count: number;
  requests: string[];
}

interface TimingReport {
  totalDuration: number;
  requestCount: number;
  avgRequestInterval: number;
  peakTimes: number[];
  quietPeriods: Array<{ start: number; end: number }>;
  buckets: TimingBucket[];
}

export class TimingAnalyzer {
  private log: LogFunction;
  private captures: NetworkCaptureResult[] = [];

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * 캡처 추가
   */
  addCapture(capture: NetworkCaptureResult): void {
    this.captures.push(capture);
  }

  /**
   * 디렉토리에서 캡처 로드
   */
  loadFromDirectory(dir: string): void {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), "utf-8");
        const capture: NetworkCaptureResult = JSON.parse(content);
        this.captures.push(capture);
      } catch (error) {
        this.log(`[TimingAnalyzer] Failed to load ${file}: ${error}`);
      }
    }
  }

  /**
   * URL 패턴별 타이밍 통계
   */
  getTimingStats(urlPattern: string | RegExp): TimingPattern {
    const regex =
      typeof urlPattern === "string" ? new RegExp(urlPattern) : urlPattern;
    const timestamps: number[] = [];

    for (const capture of this.captures) {
      for (const request of capture.requests) {
        if (regex.test(request.url)) {
          timestamps.push(request.timestamp);
        }
      }
    }

    return this.calculatePattern(timestamps);
  }

  /**
   * 전체 타이밍 분포 분석
   */
  getDistribution(bucketSize: number = 100): TimingReport {
    const allTimestamps: Array<{ time: number; url: string }> = [];

    for (const capture of this.captures) {
      for (const request of capture.requests) {
        allTimestamps.push({ time: request.timestamp, url: request.url });
      }
    }

    if (allTimestamps.length === 0) {
      return {
        totalDuration: 0,
        requestCount: 0,
        avgRequestInterval: 0,
        peakTimes: [],
        quietPeriods: [],
        buckets: [],
      };
    }

    // 정렬
    allTimestamps.sort((a, b) => a.time - b.time);

    const minTime = allTimestamps[0].time;
    const maxTime = allTimestamps[allTimestamps.length - 1].time;
    const totalDuration = maxTime - minTime;

    // 버킷 생성
    const buckets: TimingBucket[] = [];
    for (let start = 0; start <= maxTime; start += bucketSize) {
      buckets.push({
        start,
        end: start + bucketSize,
        count: 0,
        requests: [],
      });
    }

    // 요청을 버킷에 배치
    for (const { time, url } of allTimestamps) {
      const bucketIndex = Math.floor(time / bucketSize);
      if (bucketIndex < buckets.length) {
        buckets[bucketIndex].count++;
        if (buckets[bucketIndex].requests.length < 5) {
          buckets[bucketIndex].requests.push(url);
        }
      }
    }

    // 피크 타임 찾기 (상위 10%)
    const sortedBuckets = [...buckets].sort((a, b) => b.count - a.count);
    const peakThreshold = Math.max(1, Math.floor(buckets.length * 0.1));
    const peakTimes = sortedBuckets
      .slice(0, peakThreshold)
      .map((b) => b.start + bucketSize / 2);

    // 조용한 기간 찾기 (요청 없는 구간)
    const quietPeriods: Array<{ start: number; end: number }> = [];
    let quietStart: number | null = null;

    for (const bucket of buckets) {
      if (bucket.count === 0) {
        if (quietStart === null) {
          quietStart = bucket.start;
        }
      } else if (quietStart !== null) {
        if (bucket.start - quietStart >= bucketSize * 2) {
          quietPeriods.push({ start: quietStart, end: bucket.start });
        }
        quietStart = null;
      }
    }

    // 평균 요청 간격
    const intervals: number[] = [];
    for (let i = 1; i < allTimestamps.length; i++) {
      intervals.push(allTimestamps[i].time - allTimestamps[i - 1].time);
    }
    const avgRequestInterval =
      intervals.length > 0
        ? intervals.reduce((a, b) => a + b, 0) / intervals.length
        : 0;

    return {
      totalDuration,
      requestCount: allTimestamps.length,
      avgRequestInterval,
      peakTimes,
      quietPeriods,
      buckets,
    };
  }

  /**
   * 타이밍 시퀀스 생성
   */
  generateTimingSequence(
    patterns: TimingPattern[],
    preserveRelative: boolean = true
  ): number[] {
    if (patterns.length === 0) return [];

    const sequence: number[] = [];

    if (preserveRelative) {
      // 상대적 타이밍 보존
      let currentTime = 0;
      for (const pattern of patterns) {
        const delay = this.sampleFromPattern(pattern);
        sequence.push(currentTime + delay);
        currentTime += delay;
      }
    } else {
      // 각 패턴의 평균 사용
      for (const pattern of patterns) {
        sequence.push(this.sampleFromPattern(pattern));
      }
    }

    return sequence;
  }

  /**
   * 최적 딜레이 계산
   */
  calculateOptimalDelay(
    fromPattern: TimingPattern,
    toPattern: TimingPattern
  ): number {
    // 두 패턴 사이의 최적 딜레이
    const baseDiff = toPattern.avgDelay - fromPattern.avgDelay;

    if (baseDiff <= 0) {
      // 동시 또는 이전 → 최소 딜레이
      return Math.max(10, toPattern.minDelay);
    }

    // 평균과 표준편차 고려
    return Math.max(10, baseDiff - toPattern.stdDev);
  }

  /**
   * 분포에서 샘플링
   */
  sampleFromPattern(pattern: TimingPattern): number {
    switch (pattern.distribution) {
      case "uniform":
        return this.uniformSample(pattern.minDelay, pattern.maxDelay);
      case "normal":
        return this.normalSample(pattern.avgDelay, pattern.stdDev);
      case "exponential":
        return this.exponentialSample(pattern.avgDelay);
      default:
        return pattern.avgDelay;
    }
  }

  /**
   * 리포트를 파일로 저장
   */
  exportReport(outputPath: string): void {
    const report = this.getDistribution();
    const dir = path.dirname(outputPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    this.log(`[TimingAnalyzer] Exported report to: ${outputPath}`);
  }

  /**
   * 타이밍 패턴 계산
   */
  private calculatePattern(timestamps: number[]): TimingPattern {
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

    // 분포 추정
    const distribution = this.estimateDistribution(sorted, avgDelay, stdDev);

    return { minDelay, maxDelay, avgDelay, stdDev, distribution };
  }

  /**
   * 분포 추정
   */
  private estimateDistribution(
    values: number[],
    mean: number,
    stdDev: number
  ): TimingDistribution {
    // 변동계수 (CV) 기반 추정
    const cv = stdDev / mean;

    if (cv < 0.1) {
      return "uniform"; // 거의 일정
    } else if (cv < 0.5) {
      return "normal"; // 중간 정도 변동
    } else {
      return "exponential"; // 큰 변동
    }
  }

  /**
   * 균등 분포 샘플링
   */
  private uniformSample(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  /**
   * 정규 분포 샘플링 (Box-Muller)
   */
  private normalSample(mean: number, stdDev: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, mean + z * stdDev);
  }

  /**
   * 지수 분포 샘플링
   */
  private exponentialSample(mean: number): number {
    return -mean * Math.log(Math.random());
  }
}
