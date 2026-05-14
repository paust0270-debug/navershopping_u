import type { RankCheckPage } from "../rank-check-shopping";
import type { Page } from "patchright";
import type { EngineRuntime } from "../engine-config";

export type FlowLog = (msg: string, level?: "info" | "warn" | "error") => void;
export type FlowSleep = (ms: number) => Promise<void>;

export interface FlowWorkItem {
  taskId: number;
  slotSequence: number;
  keyword: string;
  productName: string;
  mid: string;
  linkUrl: string;
  keywordName?: string;
  secondKeywordRaw?: string;
  catalogMid?: string;
  productTitle?: string;
}

export type FlowFailReason =
  | "NO_MID_MATCH"
  | "CAPTCHA_UNSOLVED"
  | "PAGE_NOT_LOADED"
  | "PRODUCT_DELETED"
  | "TIMEOUT"
  | "IP_BLOCKED"
  | "DETAIL_NOT_REACHED"
  | "LOGIN_FAILED"
  | "INVALID_TASK"
  | "PRODUCT_NOT_FOUND";

export interface FlowEngineResult {
  productPageEntered: boolean;
  captchaDetected: boolean;
  captchaSolved: boolean;
  midMatched: boolean;
  failReason?: FlowFailReason;
  error?: string;
  secondSearchPhraseUsed?: string;
  rankCheckMode?: boolean;
  rankCheckOk?: boolean;
  shoppingRank?: number | null;
  reviewCount?: number | null;
  starRating?: number | null;
  extractedProductTitle?: string | null;
  catalogMid?: string | null;
}

export interface FlowRunDeps {
  log: FlowLog;
  sleep: FlowSleep;
}

export interface RankCheckFlowInput {
  page: RankCheckPage;
  work: FlowWorkItem;
  workerId: number;
}

export interface TrafficSearchFlowSetup {
  ok: boolean;
  flowLabel: string;
  secondSearchPhraseUsed?: string;
  failReason?: FlowFailReason;
  error?: string;
}

export interface TrafficSearchFlowInput {
  page: Page;
  mid: string;
  productName: string;
  keyword: string;
  workerId: number;
  engine: EngineRuntime;
  keywordName?: string;
  secondKeywordRaw?: string;
  catalogMid?: string;
}

export interface TrafficSearchFlowDeps extends FlowRunDeps {
  isSecondComboBlacklisted: (engine: EngineRuntime, mid: string, secondSearchPhrase: string) => boolean;
  countBlacklistedSecondCombosForMid: (engine: EngineRuntime, mid: string) => number;
}
