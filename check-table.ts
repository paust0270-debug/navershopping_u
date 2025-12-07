import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_PRODUCTION_URL!,
  process.env.SUPABASE_PRODUCTION_KEY!
);

async function check() {
  // traffic_navershopping 테이블 샘플 조회
  const { data, error } = await supabase
    .from("traffic_navershopping")
    .select("*")
    .limit(3);

  if (error) {
    console.log("Error:", error.message);
    return;
  }

  console.log("=== traffic_navershopping 샘플 ===");
  console.log(JSON.stringify(data, null, 2));

  // 컬럼 목록
  if (data && data.length > 0) {
    console.log("\n=== 컬럼 목록 ===");
    console.log(Object.keys(data[0]));
  }
}

check();
