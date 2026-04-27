import { ReceiptCaptchaSolverPRB } from "../captcha/ReceiptCaptchaSolverPRB";
import { findNaverShoppingRankByMid } from "../rank-check-shopping";
import type { FlowEngineResult, FlowRunDeps, RankCheckFlowInput } from "./types";

/** Flow D: Naver shopping-tab rank check only. */
export async function runRankCheckFlow(
  input: RankCheckFlowInput,
  deps: FlowRunDeps
): Promise<FlowEngineResult> {
  const { page, work, workerId } = input;
  const { log, sleep } = deps;
  const result: FlowEngineResult = {
    productPageEntered: false,
    captchaDetected: false,
    captchaSolved: false,
    midMatched: false,
    rankCheckMode: true,
    rankCheckOk: false,
    shoppingRank: null,
  };

  try {
    const kw = work.keyword.trim();
    const mid = work.mid;
    const maxPages = 15;
    log(`[Worker ${workerId}] D모드 순위체크: "${kw.substring(0, 40)}..." mid=${mid} (최대 ${maxPages}페이지)`);

    const rankCaptchaSolver = new ReceiptCaptchaSolverPRB((msg) => log(`[Worker ${workerId}] ${msg}`));
    const detail = await findNaverShoppingRankByMid(
      page,
      kw,
      mid,
      maxPages,
      (m) => log(`[Worker ${workerId}] ${m}`),
      sleep,
      (p) => rankCaptchaSolver.solve(p),
      work.productName || kw
    );

    if (detail.rank != null && detail.rank > 0) {
      result.shoppingRank = detail.rank;
      result.reviewCount = detail.reviewCount;
      result.starRating = detail.starRating;
      result.extractedProductTitle = detail.productTitle?.trim() || null;
      result.catalogMid = detail.catalogMid || null;
      result.rankCheckOk = true;
      result.midMatched = true;
      log(
        `[Worker ${workerId}] 순위: ${detail.rank}위` +
          (detail.reviewCount != null ? ` | 리뷰 ${detail.reviewCount}` : "") +
          (detail.starRating != null ? ` | 별 ${detail.starRating}` : "") +
          (result.extractedProductTitle
            ? ` | 제목 "${result.extractedProductTitle.substring(0, 36)}${result.extractedProductTitle.length > 36 ? "…" : ""}"`
            : "")
      );
    } else {
      result.failReason = "NO_MID_MATCH";
      result.error = "순위권_미발견";
      log(`[Worker ${workerId}] 순위권 내 MID 없음`, "warn");
    }
  } catch (e: any) {
    result.error = e?.message || "Unknown";
    result.failReason = "TIMEOUT";
    log(`[Worker ${workerId}] 순위체크 예외: ${result.error}`, "warn");
  }

  return result;
}
