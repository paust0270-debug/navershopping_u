import * as fs from "fs";
import * as path from "path";
import type { EngineConfigFile, SearchFlowVersion } from "./engine-config";

export interface StrategyTask {
  checked?: boolean;
  keyword: string;
  linkUrl: string;
  keywordName?: string;
  targetCount?: number;
  productTitle?: string;
  currentRank?: string;
  startRank?: string;
  trafficOk?: number;
  trafficFail?: number;
  yesterdayOk?: number;
  yesterdayFail?: number;
  reviewCount?: string;
  starRating?: string;
}

export interface StrategyFile {
  version: 1;
  name: string;
  description?: string;
  runtime?: EngineConfigFile;
  tasks: StrategyTask[];
}

export interface NormalizedStrategyTask {
  checked: boolean;
  keyword: string;
  linkUrl: string;
  mid: string;
  keywordName: string;
  targetCount: number;
  productTitle: string;
  currentRank: string;
  startRank: string;
  trafficOk: number;
  trafficFail: number;
  yesterdayOk: number;
  yesterdayFail: number;
  reviewCount: string;
  starRating: string;
}

export interface NormalizedStrategyFile {
  version: 1;
  name: string;
  description?: string;
  runtime: EngineConfigFile;
  tasks: NormalizedStrategyTask[];
}

export interface StrategyValidation {
  errors: string[];
  warnings: string[];
}

export interface ApplyStrategyOptions {
  taskIndex?: number;
  writeNextTask?: boolean;
}

export interface ApplyStrategyResult {
  configPath: string;
  tasksPath: string;
  nextTaskPath?: string;
  selectedTask?: NormalizedStrategyTask;
}

const TASKS_TEXT_HEADER =
  "검색키워드\t상품 URL\t2차키워드\t목표\t상품명\t현재순위\t시작순위\t오늘성공\t오늘실패\t어제성공\t어제실패\t리뷰수\t별점";

function toNonNegativeInt(value: unknown): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}

export function extractMidFromLinkUrl(linkUrl: string): string {
  const match = String(linkUrl).match(/\/products\/(\d+)/);
  return match ? match[1] : "";
}

function normalizeRuntime(strategy: StrategyFile): EngineConfigFile {
  const runtime = strategy.runtime || {};
  const taskSource = runtime.taskSource || {};
  return {
    ...runtime,
    taskSource: {
      taskFilePath: taskSource.taskFilePath || "engine-next-task.json",
      resultFilePath: taskSource.resultFilePath || "engine-last-result.json",
    },
  };
}

export function normalizeStrategy(strategy: StrategyFile): NormalizedStrategyFile {
  const runtime = normalizeRuntime(strategy);
  const tasks = (strategy.tasks || []).map((task) => {
    const keyword = String(task.keyword || "").trim();
    const linkUrl = String(task.linkUrl || "").trim();
    const keywordName = String(task.keywordName || "").trim();
    return {
      checked: task.checked !== false,
      keyword,
      linkUrl,
      mid: extractMidFromLinkUrl(linkUrl),
      keywordName,
      targetCount: toNonNegativeInt(task.targetCount),
      productTitle: String(task.productTitle || "").trim(),
      currentRank: String(task.currentRank || "").trim(),
      startRank: String(task.startRank || "").trim(),
      trafficOk: toNonNegativeInt(task.trafficOk),
      trafficFail: toNonNegativeInt(task.trafficFail),
      yesterdayOk: toNonNegativeInt(task.yesterdayOk),
      yesterdayFail: toNonNegativeInt(task.yesterdayFail),
      reviewCount: String(task.reviewCount || "").trim(),
      starRating: String(task.starRating || "").trim(),
    };
  });

  return {
    version: 1,
    name: String(strategy.name || "").trim(),
    description: strategy.description?.trim(),
    runtime,
    tasks,
  };
}

export function validateStrategy(strategy: StrategyFile): StrategyValidation {
  const normalized = normalizeStrategy(strategy);
  const errors: string[] = [];
  const warnings: string[] = [];
  const flow = normalized.runtime.search?.searchFlowVersion || "A";

  if (normalized.version !== 1) {
    errors.push(`Unsupported strategy version: ${String(strategy.version)}`);
  }
  if (!normalized.name) {
    errors.push("Strategy name is required.");
  }
  if (!normalized.tasks.length) {
    errors.push("At least one task is required.");
  }
  if (!isSupportedSearchFlowVersion(flow)) {
    errors.push(`Unsupported searchFlowVersion: ${String(flow)}`);
  }

  normalized.tasks.forEach((task, index) => {
    const label = `tasks[${index}]`;
    if (!task.keyword) {
      errors.push(`${label}: keyword is required.`);
    }
    if (!task.linkUrl) {
      errors.push(`${label}: linkUrl is required.`);
    }
    if (!task.mid) {
      errors.push(`${label}: linkUrl must include /products/<mid>.`);
    }
    if (flow === "C" && !task.keywordName) {
      errors.push(`${label}: flow C requires keywordName.`);
    }
    if (flow !== "D" && task.checked && task.targetCount <= 0) {
      warnings.push(`${label}: non-D flows usually need targetCount > 0 for infinite-run parity.`);
    }
  });

  if (!normalized.tasks.some((task) => task.checked)) {
    warnings.push("No tasks are checked. tasks.txt will be generated, but next-task selection will fail.");
  }

  return { errors, warnings };
}

function isSupportedSearchFlowVersion(value: string): value is SearchFlowVersion {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "E" || value === "F";
}

export function loadStrategyFile(strategyPath: string): StrategyFile {
  const raw = fs.readFileSync(strategyPath, "utf-8");
  return JSON.parse(raw) as StrategyFile;
}

export function formatTasksText(tasks: NormalizedStrategyTask[]): string {
  const lines = tasks.map((task) => {
    return [
      task.keyword,
      task.linkUrl,
      task.keywordName,
      task.targetCount,
      task.productTitle,
      task.currentRank,
      task.startRank,
      task.trafficOk,
      task.trafficFail,
      task.yesterdayOk,
      task.yesterdayFail,
      task.reviewCount,
      task.starRating,
    ].join("\t");
  });

  return [`#date\t${todayYmd()}`, TASKS_TEXT_HEADER, ...lines].join("\n");
}

function todayYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getCheckedTask(tasks: NormalizedStrategyTask[], taskIndex = 0): NormalizedStrategyTask | undefined {
  const checkedTasks = tasks.filter((task) => task.checked);
  return checkedTasks[taskIndex];
}

export function buildEngineTask(task: NormalizedStrategyTask) {
  return {
    keyword: task.keyword,
    linkUrl: task.linkUrl,
    slotSequence: 0,
    keywordName: task.keywordName || undefined,
  };
}

export function applyStrategyToDirectory(
  strategy: StrategyFile,
  outputDir: string,
  options: ApplyStrategyOptions = {}
): ApplyStrategyResult {
  const validation = validateStrategy(strategy);
  if (validation.errors.length > 0) {
    throw new Error(validation.errors.join("\n"));
  }

  const normalized = normalizeStrategy(strategy);
  const runtime = normalized.runtime;
  const taskSource = runtime.taskSource || {};
  const configPath = path.join(outputDir, "engine-config.json");
  const tasksPath = path.join(outputDir, "traffic-engine-gui", "tasks.txt");
  const nextTaskRel = taskSource.taskFilePath || "engine-next-task.json";
  const nextTaskPath = path.isAbsolute(nextTaskRel) ? nextTaskRel : path.join(outputDir, nextTaskRel);
  const shouldWriteNextTask = options.writeNextTask !== false;
  const selectedTask = getCheckedTask(normalized.tasks, options.taskIndex ?? 0);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(runtime, null, 2), "utf-8");
  fs.writeFileSync(tasksPath, formatTasksText(normalized.tasks), "utf-8");

  if (shouldWriteNextTask) {
    if (!selectedTask) {
      throw new Error("No checked task is available for engine-next-task.json.");
    }
    fs.mkdirSync(path.dirname(nextTaskPath), { recursive: true });
    fs.writeFileSync(nextTaskPath, JSON.stringify(buildEngineTask(selectedTask), null, 2), "utf-8");
  }

  return {
    configPath,
    tasksPath,
    nextTaskPath: shouldWriteNextTask ? nextTaskPath : undefined,
    selectedTask,
  };
}
