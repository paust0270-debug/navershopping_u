/**
 * Timing Simulator
 *
 * 네트워크 요청 타이밍 시뮬레이션
 * - 원본 로그의 타이밍 패턴 재현
 * - 랜덤 지터 추가
 * - 가변 딜레이 생성
 */

import type { TimingPattern, LogFunction } from "../types";

export class TimingSimulator {
  private log: LogFunction;
  private lastRequestTime: number = 0;

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * 패턴 기반 딜레이 계산
   */
  calculateDelay(pattern: TimingPattern): number {
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
   * 랜덤 지터 추가
   */
  addJitter(baseDelay: number, jitterPercent: number = 0.2): number {
    const jitterRange = baseDelay * jitterPercent;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    return Math.max(0, baseDelay + jitter);
  }

  /**
   * 딜레이 적용 sleep
   */
  async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 패턴 기반 sleep
   */
  async sleepWithPattern(pattern: TimingPattern, jitter: boolean = true): Promise<number> {
    let delay = this.calculateDelay(pattern);

    if (jitter) {
      delay = this.addJitter(delay);
    }

    await this.sleep(delay);
    return delay;
  }

  /**
   * 상대적 타이밍으로 sleep
   */
  async sleepRelative(targetTime: number, baseTime: number = 0): Promise<number> {
    const now = Date.now();
    const elapsed = now - baseTime;
    const delay = Math.max(0, targetTime - elapsed);

    if (delay > 0) {
      await this.sleep(delay);
    }

    return delay;
  }

  /**
   * 인간화된 딜레이 (v7_engine 스타일)
   */
  async humanDelay(min: number = 100, max: number = 300): Promise<void> {
    const delay = this.randomBetween(min, max);
    await this.sleep(delay);
  }

  /**
   * 타이밍 시퀀스 생성
   */
  generateTimingSequence(
    count: number,
    basePattern: TimingPattern
  ): number[] {
    const sequence: number[] = [];
    let currentTime = 0;

    for (let i = 0; i < count; i++) {
      const delay = this.calculateDelay(basePattern);
      currentTime += delay;
      sequence.push(currentTime);
    }

    return sequence;
  }

  /**
   * 배치 요청 타이밍 생성 (병렬 그룹)
   */
  generateBatchTiming(
    batchSize: number,
    groupDelay: number = 10
  ): number[] {
    // 같은 배치 내에서는 작은 지터만
    return Array.from({ length: batchSize }, (_, i) => {
      return i * groupDelay + this.randomBetween(0, groupDelay);
    });
  }

  /**
   * 두 요청 사이 최소 딜레이 보장
   */
  async ensureMinDelay(minDelay: number = 50): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    if (elapsed < minDelay) {
      await this.sleep(minDelay - elapsed);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * 타이밍 리셋
   */
  reset(): void {
    this.lastRequestTime = 0;
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

  /**
   * 범위 내 랜덤 (정수)
   */
  randomBetween(min: number, max: number): number {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  /**
   * 체류 시간 (dwell time) - v7_engine 호환
   */
  getDwellTime(): number {
    // 1~3초 사이 랜덤
    return this.randomBetween(1000, 3000);
  }

  /**
   * 키 입력 딜레이 - v7_engine 호환
   */
  getKeyDelay(): number {
    // 30~60ms
    return this.randomBetween(30, 60);
  }

  /**
   * 클릭 전 호버 딜레이 - v7_engine 호환
   */
  getHoverDelay(): number {
    // 200~400ms
    return this.randomBetween(200, 400);
  }

  /**
   * 스크롤 스텝 딜레이 - v7_engine 호환
   */
  getScrollStepDelay(): number {
    // 80~140ms
    return this.randomBetween(80, 140);
  }
}
