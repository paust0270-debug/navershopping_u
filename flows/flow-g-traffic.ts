import type { Locator, Page } from "patchright";
import type { EngineRuntime } from "../engine-config";
import type { TrafficSearchFlowDeps, TrafficSearchFlowInput, TrafficSearchFlowSetup } from "./types";
import {
  buildGIntegratedFiveWordQuery,
  buildIntegratedSearchUrl,
  pickGSecondSearchPhraseAvoidingBlacklist,
} from "./traffic-keywords";

const G_FORCE_FULL_SECOND_SEARCH_AFTER_MISSES = 10;

async function resolveMobileIntegratedSearchInput(page: Page): Promise<Locator | null> {
  const combined =
    "#nx_query, input#query, input[name='query'][type='search'], input[name='query'], " +
    "form[role='search'] input[type='text'], .search_input input[type='text'], header input[type='text']";
  const loc = page.locator(combined).first();
  try {
    await loc.waitFor({ state: "visible", timeout: 15000 });
    return loc;
  } catch {
    return null;
  }
}

/**
 * 모바일 통합검색 상단 검색창: 전체 선택 → 삭제 → 2차 검색어 붙여넣기 → Enter.
 * 실패 시 호출부에서 URL goto 폴백.
 */
async function integratedSearchClearAllAndSubmitNewQuery(
  page: Page,
  engine: EngineRuntime,
  workerId: number,
  deps: TrafficSearchFlowDeps,
  newQuery: string
): Promise<boolean> {
  const q = (newQuery || "").trim();
  if (!q) return false;

  const portalSearchInput = await resolveMobileIntegratedSearchInput(page);
  if (!portalSearchInput) {
    deps.log(`[Worker ${workerId}] G모드 통합검색 입력창 미발견`, "warn");
    return false;
  }

  const context = page.context();
  try {
    await portalSearchInput.click({ force: true });
  } catch {
    await portalSearchInput
      .evaluate((el) => {
        try {
          (el as HTMLElement).scrollIntoView({ block: "center", inline: "center" });
          (el as HTMLElement).focus();
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  }

  await deps.sleep(engine.delay("secondSearchField"));
  await page.keyboard.press("Control+a");
  await deps.sleep(40);
  await page.keyboard.press("Backspace");
  await deps.sleep(50);

  for (const origin of ["https://m.search.naver.com", "https://search.naver.com"]) {
    try {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    } catch {
      /* ignore */
    }
  }

  try {
    await page.evaluate(async (t) => {
      await navigator.clipboard.writeText(t);
    }, q);
    await page.keyboard.press("Control+v");
  } catch (e: unknown) {
    deps.log(`[Worker ${workerId}] G모드 2차 클립보드 붙여넣기 실패 → value 폴백: ${String(e)}`, "warn");
  }

  await deps.sleep(engine.delay("afterSecondKeywordType"));

  let inBox = (await portalSearchInput.inputValue().catch(() => "")).trim();
  if (!inBox && q) {
    try {
      await portalSearchInput.click({ force: true });
    } catch {
      await portalSearchInput
        .evaluate((el) => {
          try {
            (el as HTMLElement).scrollIntoView({ block: "center", inline: "center" });
            (el as HTMLElement).focus();
          } catch {
            /* ignore */
          }
        })
        .catch(() => {});
    }
    await deps.sleep(80);
    await portalSearchInput
      .evaluate((el, value) => {
        const input = el as HTMLInputElement;
        input.value = String(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, q)
      .catch(() => {});
    await deps.sleep(engine.delay("afterSecondKeywordType"));
    inBox = (await portalSearchInput.inputValue().catch(() => "")).trim();
  }

  if (!inBox.trim()) {
    deps.log(`[Worker ${workerId}] G모드 2차 검색어 입력 후에도 비어 있음`, "warn");
    return false;
  }

  deps.log(`[Worker ${workerId}] G모드 2차 검색창 전체 삭제 후 재입력 → Enter`);
  await page.keyboard.press("Enter");
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 45000 });
  } catch {
    /* SPA 등 */
  }
  return true;
}

/** 1차는 URL 진입, 2차는 통합검색창 전체 삭제 후 재입력(실패 시 URL goto). 5단어·제외키워드 로직은 traffic-keywords 참고. */
export async function runTrafficFlowG(
  input: TrafficSearchFlowInput,
  deps: TrafficSearchFlowDeps,
  flowLabel: string
): Promise<TrafficSearchFlowSetup> {
  const { page, mid, productName, keyword, workerId, engine, keywordName, catalogMid, secondKeywordRaw } = input;
  const firstKeyword = (keyword || "").trim() || "상품";
  const secondaryText =
    (secondKeywordRaw || keywordName || productName || "").trim() || firstKeyword;

  const firstPhrase = buildGIntegratedFiveWordQuery(firstKeyword, secondaryText);
  deps.log(`[Worker ${workerId}] G모드 1차 통합검색(5단어): ${firstPhrase}`);
  await page.goto(buildIntegratedSearchUrl(firstPhrase), { waitUntil: "domcontentloaded", timeout: 60000 });
  await deps.sleep(engine.delay("afterFirstSearchLoad"));

  const secondKeywordPool = (keywordName || productName || "").trim() || firstKeyword;
  const midMissCount = deps.countBlacklistedSecondCombosForMid(engine, mid);
  const mustUseFullSecondKeyword = midMissCount >= G_FORCE_FULL_SECOND_SEARCH_AFTER_MISSES;

  let secondSearchKeyword: string;
  if (mustUseFullSecondKeyword) {
    secondSearchKeyword = secondKeywordPool;
    deps.log(
      `[Worker ${workerId}] G모드 2차 미노출 누적 ${midMissCount}회(>=${G_FORCE_FULL_SECOND_SEARCH_AFTER_MISSES}) → 풀검색어 강제: ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`,
      "warn"
    );
  } else if (catalogMid && productName && productName.length > 10) {
    secondSearchKeyword = productName;
    deps.log(
      `[Worker ${workerId}] G모드 2차 통합검색 (풀네임·A동일): ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`
    );
  } else {
    secondSearchKeyword = pickGSecondSearchPhraseAvoidingBlacklist(
      engine,
      mid,
      firstKeyword,
      secondKeywordPool,
      workerId,
      deps
    );
    deps.log(
      `[Worker ${workerId}] G모드 2차 통합검색(5단어·꼬리없음): ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`
    );
  }

  if (mustUseFullSecondKeyword && deps.isSecondComboBlacklisted(engine, mid, secondSearchKeyword)) {
    deps.log(
      `[Worker ${workerId}] G모드 2차 풀검색어 미노출 이력 존재하지만 실시간 재검증 진행(mid=${mid})`,
      "warn"
    );
  }

  const typedOk = await integratedSearchClearAllAndSubmitNewQuery(
    page,
    engine,
    workerId,
    deps,
    secondSearchKeyword
  );
  if (!typedOk) {
    deps.log(`[Worker ${workerId}] G모드 2차 검색창 입력 실패 → URL 직접 이동 폴백`, "warn");
    await page.goto(buildIntegratedSearchUrl(secondSearchKeyword), { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  await deps.sleep(engine.delay("afterSecondSearchLoad"));
  return { ok: true, flowLabel, secondSearchPhraseUsed: secondSearchKeyword };
}
