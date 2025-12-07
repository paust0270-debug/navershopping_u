import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config();

async function checkSchemas() {
  // Production DB
  const prodUrl = process.env.SUPABASE_PRODUCTION_URL!;
  const prodKey = process.env.SUPABASE_PRODUCTION_KEY!;
  const prodClient = createClient(prodUrl, prodKey);

  console.log("=== Production DB (adpang_production) ===");

  // Check traffic_navershopping
  const { data: tn, error: tnErr } = await prodClient
    .from("traffic_navershopping")
    .select("*")
    .limit(1);

  if (tnErr) {
    console.log("traffic_navershopping error:", tnErr.message);
  } else {
    console.log("traffic_navershopping columns:", tn?.[0] ? Object.keys(tn[0]) : "empty");
  }

  // Check slot_naver
  const { data: sn, error: snErr } = await prodClient
    .from("slot_naver")
    .select("*")
    .limit(1);

  if (snErr) {
    console.log("slot_naver error:", snErr.message);
  } else {
    console.log("slot_naver columns:", sn?.[0] ? Object.keys(sn[0]) : "empty");
  }

  // Control DB
  const controlUrl = process.env.SUPABASE_CONTROL_URL!;
  const controlKey = process.env.SUPABASE_CONTROL_KEY!;
  const controlClient = createClient(controlUrl, controlKey);

  console.log("\n=== Control DB (navertrafictest) ===");

  // Check workerNodes
  const { data: wn, error: wnErr } = await controlClient
    .from("workerNodes")
    .select("*")
    .limit(1);

  if (wnErr) {
    console.log("workerNodes error:", wnErr.message);
  } else {
    console.log("workerNodes columns:", wn?.[0] ? Object.keys(wn[0]) : "empty table (check schema via SQL)");
  }

  // Check traffic_mode_settings
  const { data: tms, error: tmsErr } = await controlClient
    .from("traffic_mode_settings")
    .select("*")
    .limit(1);

  if (tmsErr) {
    console.log("traffic_mode_settings error:", tmsErr.message);
  } else {
    console.log("traffic_mode_settings columns:", tms?.[0] ? Object.keys(tms[0]) : "empty table");
  }
}

checkSchemas().catch(console.error);
