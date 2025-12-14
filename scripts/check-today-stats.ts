import * as fs from "fs";
import * as path from "path";

const today = new Date().toISOString().split("T")[0];
const logDir = path.join(__dirname, "..", "logs", "mass-rotation");

const products = {
  goldenbanji: { mid: "90173163527", name: "골든바지" },
  sinzimoru: { mid: "89029512267", name: "신지모루 무선충전기" },
  chaipot: { mid: "83539482665", name: "차이팟" },
};

console.log(`\n📊 오늘(${today}) 상품별 트래픽 현황\n${"=".repeat(60)}\n`);

Object.entries(products).forEach(([key, product]) => {
  const files = fs.readdirSync(logDir).filter(f => f.startsWith(`run-${today}`) && f.endsWith(".json"));

  let totalRequests = 0;
  let successRequests = 0;
  let runs = 0;

  files.forEach(file => {
    try {
      const content = fs.readFileSync(path.join(logDir, file), "utf-8");
      const data = JSON.parse(content);

      if (data.config?.product?.mid === product.mid || data.args?.mid === product.mid) {
        runs++;
        totalRequests += data.stats?.totalRequests || data.args?.count || 0;
        successRequests += data.stats?.successRequests || 0;
      }
    } catch (e) {
      // skip
    }
  });

  console.log(`${product.name} (MID: ${product.mid})`);
  console.log(`  실행 횟수: ${runs}회`);
  console.log(`  요청 총합: ${totalRequests}회`);
  console.log(`  성공: ${successRequests}회`);
  console.log(`  목표 대비: ${totalRequests}/2000 (${((totalRequests/2000)*100).toFixed(1)}%)`);
  console.log(`  부족분: ${Math.max(0, 2000 - totalRequests)}회\n`);
});
