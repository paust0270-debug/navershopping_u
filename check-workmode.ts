import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_PRODUCTION_URL!,
  process.env.SUPABASE_PRODUCTION_KEY!
);

async function check() {
  // work_modeÄ t´¸
  const { data, error } = await supabase
    .from("slot_naver")
    .select("work_mode, mid, product_name")
    .not("mid", "is", null)
    .limit(200);

  if (error) {
    console.log("Error:", error.message);
    return;
  }

  const counts: Record<string, number> = {};
  data?.forEach(row => {
    const mode = row.work_mode || "null";
    counts[mode] = (counts[mode] || 0) + 1;
  });

  console.log("\n=== slot_naver work_mode „ì ===");
  console.log("Total with mid:", data?.length);
  console.log("work_mode counts:", counts);

  // tonggum_nologin Áˆ Ux
  const { data: tonggumData } = await supabase
    .from("slot_naver")
    .select("id, keyword, product_name, mid, work_mode")
    .eq("work_mode", "tonggum_nologin")
    .not("mid", "is", null)
    .limit(5);

  console.log("\n=== tonggum_nologin Áˆ ===");
  console.log(tonggumData || "ÆL");
}

check();
