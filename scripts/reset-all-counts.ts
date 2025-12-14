import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_PRODUCTION_URL!,
  process.env.SUPABASE_PRODUCTION_KEY!
);

async function resetAll() {
  console.log("=== slot_naver 전체 카운터 초기화 ===\n");

  // 현재 상태 확인
  const { data: before } = await supabase
    .from("slot_naver")
    .select("id, success_count, fail_count")
    .or("fail_count.gt.0,success_count.gt.0");

  console.log("초기화 대상:", before?.length || 0, "개 슬롯");

  if (before && before.length > 0) {
    console.log("\n현재 상태 (일부):");
    before.slice(0, 5).forEach((row) => {
      console.log(`  ID ${row.id}: success=${row.success_count}, fail=${row.fail_count}`);
    });
  }

  // 전체 초기화
  const { error } = await supabase
    .from("slot_naver")
    .update({
      success_count: 0,
      fail_count: 0,
      worker_lock: null,
      locked_at: null,
    })
    .gte("id", 0); // 모든 행

  if (error) {
    console.log("\n❌ 에러:", error.message);
    return;
  }

  console.log("\n✅ 전체 초기화 완료!");

  // 확인
  const { data: after } = await supabase
    .from("slot_naver")
    .select("id")
    .or("fail_count.gt.0,success_count.gt.0");

  console.log("남은 카운트 > 0:", after?.length || 0, "개");
}

resetAll();
