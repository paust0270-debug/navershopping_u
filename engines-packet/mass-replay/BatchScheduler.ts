/**
 * Batch Scheduler - 배치 스케줄링
 *
 * 핵심 기능:
 * - 총 요청 수를 랜덤 서브배치로 분할
 * - 시간대별 분산 (300/400/300)
 * - 프로필 로테이션 할당
 */

import type { LogFunction } from "../types";

// ============================================================
//  타입 정의
// ============================================================

export interface BatchConfig {
  totalCount: number;           // 총 요청 수 (default: 1000)
  minBatchSize: number;         // 최소 배치 크기 (default: 40)
  maxBatchSize: number;         // 최대 배치 크기 (default: 120)
  delayBetweenBatches: [number, number];  // 배치 간 딜레이 [min, max] ms
  profileCount: number;         // 프로필 수 (default: 20)
}

export interface SubBatch {
  id: number;
  count: number;
  profileId: number;
  status: "pending" | "running" | "completed" | "failed";
  startTime?: number;
  endTime?: number;
  result?: BatchResult;
}

export interface BatchResult {
  total: number;
  success: number;
  failed: number;
  duration: number;
  errors: string[];
}

export interface ScheduleSummary {
  totalCount: number;
  batchCount: number;
  batches: SubBatch[];
  estimatedDuration: number;  // 예상 소요 시간 (ms)
}

// ============================================================
//  BatchScheduler 클래스
// ============================================================

export class BatchScheduler {
  private log: LogFunction;
  private config: BatchConfig;
  private batches: SubBatch[] = [];

  constructor(config?: Partial<BatchConfig>, logFn?: LogFunction) {
    this.log = logFn || console.log;

    this.config = {
      totalCount: config?.totalCount ?? 1000,
      minBatchSize: config?.minBatchSize ?? 40,
      maxBatchSize: config?.maxBatchSize ?? 120,
      delayBetweenBatches: config?.delayBetweenBatches ?? [5000, 15000],
      profileCount: config?.profileCount ?? 20,
    };
  }

  /**
   * 랜덤 서브배치 생성
   * 예: 300 → [58, 42, 98, 52, 50]
   */
  generateBatches(totalCount?: number): SubBatch[] {
    const total = totalCount ?? this.config.totalCount;
    this.batches = [];

    let remaining = total;
    let batchId = 0;
    let profileIndex = 0;

    this.log(`[BatchScheduler] Generating batches for ${total} requests`);

    while (remaining > 0) {
      // 배치 크기 결정
      let batchSize: number;

      if (remaining <= this.config.maxBatchSize) {
        // 남은 수가 최대 배치 크기 이하면 전부
        batchSize = remaining;
      } else if (remaining <= this.config.minBatchSize * 2) {
        // 남은 수가 최소 배치 2개분 이하면 절반씩
        batchSize = Math.ceil(remaining / 2);
      } else {
        // 랜덤 배치 크기
        const maxAllowed = Math.min(
          this.config.maxBatchSize,
          remaining - this.config.minBatchSize
        );
        batchSize = this.randomBetween(this.config.minBatchSize, maxAllowed);
      }

      // 프로필 할당 (라운드 로빈)
      const profileId = (profileIndex % this.config.profileCount) + 1;
      profileIndex++;

      this.batches.push({
        id: batchId++,
        count: batchSize,
        profileId,
        status: "pending",
      });

      remaining -= batchSize;
    }

    // 셔플 (순서 무작위화)
    this.shuffle(this.batches);

    // ID 재할당 (셔플 후)
    this.batches.forEach((b, i) => (b.id = i));

    this.log(`[BatchScheduler] Generated ${this.batches.length} batches: [${this.batches.map(b => b.count).join(", ")}]`);

    return this.batches;
  }

  /**
   * 스케줄 요약
   */
  getSummary(): ScheduleSummary {
    const avgDelay = (this.config.delayBetweenBatches[0] + this.config.delayBetweenBatches[1]) / 2;
    const avgBatchTime = 30000;  // 배치당 평균 30초 (추정)

    const estimatedDuration =
      this.batches.length * avgBatchTime +
      (this.batches.length - 1) * avgDelay;

    return {
      totalCount: this.batches.reduce((sum, b) => sum + b.count, 0),
      batchCount: this.batches.length,
      batches: [...this.batches],
      estimatedDuration,
    };
  }

  /**
   * 다음 배치 가져오기
   */
  getNextBatch(): SubBatch | null {
    const pending = this.batches.find(b => b.status === "pending");
    return pending || null;
  }

  /**
   * 배치 시작 마킹
   */
  startBatch(batchId: number): void {
    const batch = this.batches.find(b => b.id === batchId);
    if (batch) {
      batch.status = "running";
      batch.startTime = Date.now();
      this.log(`[BatchScheduler] Starting batch ${batchId}: ${batch.count} requests with profile ${batch.profileId}`);
    }
  }

  /**
   * 배치 완료 마킹
   */
  completeBatch(batchId: number, result: BatchResult): void {
    const batch = this.batches.find(b => b.id === batchId);
    if (batch) {
      batch.status = result.failed === 0 ? "completed" : "failed";
      batch.endTime = Date.now();
      batch.result = result;
      this.log(`[BatchScheduler] Batch ${batchId} ${batch.status}: ${result.success}/${result.total} (${result.duration}ms)`);
    }
  }

  /**
   * 진행 상황
   */
  getProgress(): {
    total: number;
    completed: number;
    running: number;
    pending: number;
    failed: number;
    successRate: number;
  } {
    const completed = this.batches.filter(b => b.status === "completed").length;
    const running = this.batches.filter(b => b.status === "running").length;
    const pending = this.batches.filter(b => b.status === "pending").length;
    const failed = this.batches.filter(b => b.status === "failed").length;

    const totalRequests = this.batches
      .filter(b => b.result)
      .reduce((sum, b) => sum + (b.result?.total || 0), 0);
    const successRequests = this.batches
      .filter(b => b.result)
      .reduce((sum, b) => sum + (b.result?.success || 0), 0);

    return {
      total: this.batches.length,
      completed,
      running,
      pending,
      failed,
      successRate: totalRequests > 0 ? (successRequests / totalRequests) * 100 : 0,
    };
  }

  /**
   * 배치 간 딜레이 가져오기
   */
  getBatchDelay(): number {
    return this.randomBetween(
      this.config.delayBetweenBatches[0],
      this.config.delayBetweenBatches[1]
    );
  }

  /**
   * 특정 프로필의 배치들 가져오기
   */
  getBatchesByProfile(profileId: number): SubBatch[] {
    return this.batches.filter(b => b.profileId === profileId);
  }

  /**
   * 모든 배치 가져오기
   */
  getAllBatches(): SubBatch[] {
    return [...this.batches];
  }

  /**
   * 완료 여부
   */
  isComplete(): boolean {
    return this.batches.every(b => b.status === "completed" || b.status === "failed");
  }

  /**
   * 리셋
   */
  reset(): void {
    this.batches.forEach(b => {
      b.status = "pending";
      b.startTime = undefined;
      b.endTime = undefined;
      b.result = undefined;
    });
    this.log("[BatchScheduler] Reset all batches");
  }

  /**
   * 시간대별 배치 생성 (300/400/300)
   */
  generateTimeSlotBatches(slots: { name: string; count: number }[]): Map<string, SubBatch[]> {
    const result = new Map<string, SubBatch[]>();

    for (const slot of slots) {
      this.log(`[BatchScheduler] Generating batches for slot "${slot.name}": ${slot.count} requests`);

      // 해당 시간대 배치 생성
      const slotBatches = this.generateBatchesInternal(slot.count);

      result.set(slot.name, slotBatches);
    }

    return result;
  }

  /**
   * 내부 배치 생성 (시간대별용)
   */
  private generateBatchesInternal(totalCount: number): SubBatch[] {
    const batches: SubBatch[] = [];
    let remaining = totalCount;
    let batchId = 0;
    let profileIndex = Math.floor(Math.random() * this.config.profileCount);  // 랜덤 시작

    while (remaining > 0) {
      let batchSize: number;

      if (remaining <= this.config.maxBatchSize) {
        batchSize = remaining;
      } else if (remaining <= this.config.minBatchSize * 2) {
        batchSize = Math.ceil(remaining / 2);
      } else {
        const maxAllowed = Math.min(
          this.config.maxBatchSize,
          remaining - this.config.minBatchSize
        );
        batchSize = this.randomBetween(this.config.minBatchSize, maxAllowed);
      }

      const profileId = (profileIndex % this.config.profileCount) + 1;
      profileIndex++;

      batches.push({
        id: batchId++,
        count: batchSize,
        profileId,
        status: "pending",
      });

      remaining -= batchSize;
    }

    // 셔플
    this.shuffle(batches);
    batches.forEach((b, i) => (b.id = i));

    return batches;
  }

  /**
   * 랜덤 범위
   */
  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 배열 셔플 (Fisher-Yates)
   */
  private shuffle<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  /**
   * 설정 가져오기
   */
  getConfig(): BatchConfig {
    return { ...this.config };
  }
}
