/**
 * Patchright 코어(userAgent.js)가 getPlaywrightVersion()에서 patchright-core/package.json 을 require 합니다.
 * GUI 포터블 빌드(resources/runner)에서 해당 JSON이 없으면 D모드 launchPersistentContext 시 즉시 실패합니다.
 * PW_VERSION_OVERRIDE 가 설정되어 있으면 JSON을 읽지 않습니다.
 */
import * as fs from "fs";
import * as path from "path";

if (!process.env.PW_VERSION_OVERRIDE) {
  const tryRead = (base: string) => {
    const p = path.join(base, "node_modules", "patchright-core", "package.json");
    try {
      const v = JSON.parse(fs.readFileSync(p, "utf8"))?.version;
      if (typeof v === "string" && v.length) return v;
    } catch {
      /* missing or unreadable */
    }
    return null;
  };
  const bases = [__dirname, path.resolve(__dirname, "..")];
  let v: string | null = null;
  for (const b of bases) {
    v = tryRead(b);
    if (v) break;
  }
  process.env.PW_VERSION_OVERRIDE = v || "1.49.1";
}
