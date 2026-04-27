import type { TrafficSearchFlowDeps, TrafficSearchFlowInput, TrafficSearchFlowSetup } from "./types";
import { buildIntegratedSearchUrl } from "./traffic-keywords";

export async function runTrafficFlowC(
  input: TrafficSearchFlowInput,
  deps: TrafficSearchFlowDeps,
  flowLabel: string
): Promise<TrafficSearchFlowSetup> {
  const { page, workerId, engine, secondKeywordRaw } = input;
  const onlySecond = (secondKeywordRaw || "").trim();
  if (!onlySecond) {
    deps.log(`[Worker ${workerId}] C모드는 2차 키워드 필수 — 작업 스킵`, "warn");
    return {
      ok: false,
      flowLabel,
      failReason: "INVALID_TASK",
      error: "C모드_2차키워드없음",
    };
  }

  deps.log(`[Worker ${workerId}] C모드 통합검색 (2차 키워드): ${onlySecond.substring(0, 48)}${onlySecond.length > 48 ? "..." : ""}`);
  await page.goto(buildIntegratedSearchUrl(onlySecond), { waitUntil: "domcontentloaded", timeout: 60000 });
  await deps.sleep(engine.delay("afterFirstSearchLoad"));
  return { ok: true, flowLabel, secondSearchPhraseUsed: onlySecond };
}
