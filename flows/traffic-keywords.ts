import type { EngineRuntime } from "../engine-config";
import type { TrafficSearchFlowDeps } from "./types";

const SECOND_SEARCH_TAIL_WORDS = ["판매", "최저가", "최저", "구매", "비교", "판매처", "추천", "가격", "구매처", "가격비교"];

function buildSecondSearchPhrase(firstKeyword: string, keywordName: string): string {
  const part1 = (firstKeyword || "").trim() || "상품";
  const firstWords = new Set(
    part1
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
  );
  const nameWords = (keywordName || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .filter((w) => !firstWords.has(w));
  const part2 = nameWords.length > 0 ? nameWords[Math.floor(Math.random() * nameWords.length)] : part1;
  const part3 = SECOND_SEARCH_TAIL_WORDS[Math.floor(Math.random() * SECOND_SEARCH_TAIL_WORDS.length)];
  const parts = [part1, part2, part3];
  for (let i = parts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }
  return parts.join(" ");
}

function tokenizeKeywordWords(text: string): string[] {
  return (text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function shuffleArrayInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** G모드: 메인 키워드에서 1단어 + 2차 텍스트 풀에서 4단어(중복 최소화, 부족 시 반복 추출) = 총 5단어 */
export function buildGIntegratedFiveWordQuery(mainKeyword: string, secondaryText: string): string {
  const mainWords = tokenizeKeywordWords(mainKeyword);
  const mainPick = mainWords.length > 0 ? mainWords[Math.floor(Math.random() * mainWords.length)] : "상품";
  let pool = [...new Set(tokenizeKeywordWords(secondaryText))].filter((w) => w !== mainPick);
  if (pool.length === 0) {
    pool = [...new Set(tokenizeKeywordWords(secondaryText))];
  }
  if (pool.length === 0) {
    pool = [mainPick];
  }
  const shuffled = [...pool];
  shuffleArrayInPlace(shuffled);
  const four: string[] = [];
  for (let i = 0; i < 4; i++) {
    four.push(shuffled[i % shuffled.length]);
  }
  return [mainPick, ...four].join(" ");
}

export function pickGSecondSearchPhraseAvoidingBlacklist(
  engine: EngineRuntime,
  mid: string,
  firstKeyword: string,
  keywordName: string,
  workerId: number,
  deps: TrafficSearchFlowDeps
): string {
  if (!engine.keywordBlacklistEnabled) {
    return buildGIntegratedFiveWordQuery(firstKeyword, keywordName);
  }
  const maxTries = 200;
  for (let t = 0; t < maxTries; t++) {
    const phrase = buildGIntegratedFiveWordQuery(firstKeyword, keywordName);
    if (!deps.isSecondComboBlacklisted(engine, mid, phrase)) {
      if (t > 0) {
        deps.log(
          `[Worker ${workerId}] [KeywordBlacklist] G 2차 5단어 ${t + 1}번째 시도로 채택: "${phrase.substring(0, 50)}${phrase.length > 50 ? "..." : ""}"`
        );
      }
      return phrase;
    }
  }
  const fallback = buildGIntegratedFiveWordQuery(firstKeyword, keywordName);
  deps.log(
    `[Worker ${workerId}] [KeywordBlacklist] G 2차 제외 목록과 충돌 다수 — 임의 5단어 사용: "${fallback.substring(0, 50)}${fallback.length > 50 ? "..." : ""}"`,
    "warn"
  );
  return fallback;
}

export function pickSecondSearchPhraseAvoidingBlacklist(
  engine: EngineRuntime,
  mid: string,
  firstKeyword: string,
  keywordName: string,
  workerId: number,
  deps: TrafficSearchFlowDeps
): string {
  if (!engine.keywordBlacklistEnabled) {
    return buildSecondSearchPhrase(firstKeyword, keywordName);
  }
  const maxTries = 200;
  for (let t = 0; t < maxTries; t++) {
    const phrase = buildSecondSearchPhrase(firstKeyword, keywordName);
    if (!deps.isSecondComboBlacklisted(engine, mid, phrase)) {
      if (t > 0) {
        deps.log(
          `[Worker ${workerId}] [KeywordBlacklist] 2차 조합 ${t + 1}번째 시도로 채택: "${phrase.substring(0, 50)}${phrase.length > 50 ? "..." : ""}"`
        );
      }
      return phrase;
    }
  }
  const fallback = buildSecondSearchPhrase(firstKeyword, keywordName);
  deps.log(
    `[Worker ${workerId}] [KeywordBlacklist] 2차 조합 블랙 시도 다수 — 임의 조합 사용: "${fallback.substring(0, 50)}${fallback.length > 50 ? "..." : ""}"`,
    "warn"
  );
  return fallback;
}

function generateAckey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let r = "";
  for (let i = 0; i < 8; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

export function pickQueryWords(keyword: string, productName: string): string {
  const tails = ["추천", "할인", "후기", "인기", "베스트", "구매", "쇼핑", "특가", "세일", "가성비", "최저가", "정품"];
  const allText = `${keyword} ${productName}`.replace(/[\[\](){}]/g, " ").replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, " ");
  const pool = [...new Set(allText.split(/\s+/).filter((w) => w.length >= 2))];
  for (let j = pool.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [pool[j], pool[k]] = [pool[k], pool[j]];
  }
  const selected: string[] = [];
  for (const w of pool) {
    if (selected.length >= 3) break;
    selected.push(w);
  }
  while (selected.length < 3) {
    const avail = tails.filter((t) => !selected.includes(t));
    if (!avail.length) break;
    selected.push(avail[Math.floor(Math.random() * avail.length)]);
  }
  return selected.slice(0, 3).join(" ");
}

export function buildAckeySearchUrl(query: string, acq = query, acr = 1): string {
  const p = new URLSearchParams({
    sm: "mtp_sug.top",
    where: "m",
    query,
    ackey: generateAckey(),
    acq,
    acr: String(Math.max(1, Math.floor(acr))),
    qdt: "0",
  });
  return `https://m.search.naver.com/search.naver?${p.toString()}`;
}

export function buildIntegratedSearchUrl(query: string): string {
  const p = new URLSearchParams({
    where: "m",
    query,
  });
  return `https://m.search.naver.com/search.naver?${p.toString()}`;
}
