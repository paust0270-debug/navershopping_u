/**
 * Request Queue
 *
 * 요청 큐 관리
 * - 의존성 기반 실행 순서
 * - 병렬 실행 그룹
 * - 동시성 제한
 */

import type {
  ReplayRequest,
  ReplayResponse,
  RequestQueueItem,
  LogFunction,
} from "../types";

export interface QueueConfig {
  maxConcurrency: number;
  retryCount: number;
  retryDelay: number;
}

export class RequestQueue {
  private log: LogFunction;
  private queue: RequestQueueItem[] = [];
  private running: Map<string, RequestQueueItem> = new Map();
  private completed: Map<string, ReplayResponse> = new Map();
  private config: QueueConfig;

  constructor(config?: Partial<QueueConfig>, logFn?: LogFunction) {
    this.log = logFn || console.log;
    this.config = {
      maxConcurrency: config?.maxConcurrency ?? 6,
      retryCount: config?.retryCount ?? 2,
      retryDelay: config?.retryDelay ?? 1000,
    };
  }

  /**
   * 요청 추가
   */
  add(request: ReplayRequest, priority: number = 0): void {
    const item: RequestQueueItem = {
      request,
      priority,
      dependencies: request.pattern.dependencies,
      status: "pending",
    };

    this.queue.push(item);
    this.sortQueue();
  }

  /**
   * 여러 요청 추가
   */
  addBatch(requests: ReplayRequest[], priority: number = 0): void {
    for (const request of requests) {
      this.add(request, priority);
    }
  }

  /**
   * 큐 정렬 (우선순위 + 타이밍)
   */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      // 우선순위 먼저
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // 높은 우선순위 먼저
      }
      // 스케줄 시간
      return a.request.scheduledTime - b.request.scheduledTime;
    });
  }

  /**
   * 실행 가능한 요청 가져오기
   */
  getReady(): ReplayRequest[] {
    const ready: ReplayRequest[] = [];

    for (const item of this.queue) {
      if (item.status !== "pending") continue;

      // 의존성 확인
      const allDependenciesCompleted = item.dependencies.every((depId) =>
        this.completed.has(depId)
      );

      if (allDependenciesCompleted) {
        // 동시성 제한 확인
        if (this.running.size < this.config.maxConcurrency) {
          ready.push(item.request);
          item.status = "running";
          this.running.set(item.request.id, item);
        }
      }
    }

    return ready;
  }

  /**
   * 요청 완료 처리
   */
  complete(requestId: string, response: ReplayResponse): void {
    const item = this.running.get(requestId);
    if (!item) return;

    item.status = response.success ? "completed" : "failed";
    item.result = response;

    this.running.delete(requestId);
    this.completed.set(requestId, response);

    // 큐에서 제거
    const queueIndex = this.queue.findIndex((i) => i.request.id === requestId);
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1);
    }

    this.log(`[RequestQueue] Completed: ${requestId} (${response.status})`);
  }

  /**
   * 요청 실패 처리
   */
  fail(requestId: string, error: string): void {
    const item = this.running.get(requestId);
    if (!item) return;

    item.status = "failed";
    item.result = {
      requestId,
      url: item.request.url,
      status: 0,
      statusText: "Failed",
      headers: {},
      duration: 0,
      success: false,
      error,
    };

    this.running.delete(requestId);
    this.completed.set(requestId, item.result);

    // 큐에서 제거
    const queueIndex = this.queue.findIndex((i) => i.request.id === requestId);
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1);
    }

    this.log(`[RequestQueue] Failed: ${requestId} - ${error}`);
  }

  /**
   * 모든 요청이 완료되었는지 확인
   */
  isComplete(): boolean {
    return this.queue.length === 0 && this.running.size === 0;
  }

  /**
   * 대기 중인 요청 수
   */
  getPendingCount(): number {
    return this.queue.filter((i) => i.status === "pending").length;
  }

  /**
   * 실행 중인 요청 수
   */
  getRunningCount(): number {
    return this.running.size;
  }

  /**
   * 완료된 요청 수
   */
  getCompletedCount(): number {
    return this.completed.size;
  }

  /**
   * 실패한 요청 가져오기
   */
  getFailedRequests(): ReplayResponse[] {
    return Array.from(this.completed.values()).filter((r) => !r.success);
  }

  /**
   * 모든 결과 가져오기
   */
  getAllResults(): ReplayResponse[] {
    return Array.from(this.completed.values());
  }

  /**
   * 특정 요청 결과 가져오기
   */
  getResult(requestId: string): ReplayResponse | undefined {
    return this.completed.get(requestId);
  }

  /**
   * 의존성이 있는 요청인지 확인
   */
  hasDependency(requestId: string, dependencyId: string): boolean {
    const item = this.queue.find((i) => i.request.id === requestId);
    return item?.dependencies.includes(dependencyId) ?? false;
  }

  /**
   * 큐 초기화
   */
  clear(): void {
    this.queue = [];
    this.running.clear();
    this.completed.clear();
  }

  /**
   * 상태 요약
   */
  getStatus(): {
    pending: number;
    running: number;
    completed: number;
    failed: number;
  } {
    const failed = this.getFailedRequests().length;
    return {
      pending: this.getPendingCount(),
      running: this.getRunningCount(),
      completed: this.completed.size - failed,
      failed,
    };
  }

  /**
   * 동시성 설정 변경
   */
  setMaxConcurrency(max: number): void {
    this.config.maxConcurrency = max;
  }

  /**
   * 병렬 그룹 요청 가져오기
   */
  getParallelGroup(groupId: string): ReplayRequest[] {
    return this.queue
      .filter(
        (item) =>
          item.status === "pending" &&
          item.request.pattern.parallelGroup === groupId
      )
      .map((item) => item.request);
  }

  /**
   * 특정 그룹의 모든 요청 시작
   */
  startParallelGroup(groupId: string): ReplayRequest[] {
    const groupItems = this.queue.filter(
      (item) =>
        item.status === "pending" &&
        item.request.pattern.parallelGroup === groupId
    );

    const started: ReplayRequest[] = [];

    for (const item of groupItems) {
      // 의존성 확인
      const allDependenciesCompleted = item.dependencies.every((depId) =>
        this.completed.has(depId)
      );

      if (allDependenciesCompleted) {
        item.status = "running";
        this.running.set(item.request.id, item);
        started.push(item.request);
      }
    }

    return started;
  }
}
