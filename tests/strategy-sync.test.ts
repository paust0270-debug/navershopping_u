import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  applyStrategyToDirectory,
  formatTasksText,
  type StrategyFile,
  validateStrategy,
} from "../strategy-sync";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "strategy-sync-test-"));
}

function testApplyStrategyWritesRuntimeFiles(): void {
  const tempDir = makeTempDir();
  const strategy: StrategyFile = {
    version: 1,
    name: "flow-a-smoke",
    runtime: {
      workMode: "mobile",
      search: { searchFlowVersion: "A", maxScrollAttempts: 4 },
    },
    tasks: [
      {
        keyword: "테스트 키워드",
        linkUrl: "https://smartstore.naver.com/example/products/1234567890",
        keywordName: "보조 키워드",
        targetCount: 3,
      },
    ],
  };

  const result = applyStrategyToDirectory(strategy, tempDir);
  const configPath = result.configPath;
  const tasksPath = result.tasksPath;
  const nextTaskPath = result.nextTaskPath!;

  assert.ok(fs.existsSync(configPath), "engine-config.json should exist");
  assert.ok(fs.existsSync(tasksPath), "tasks.txt should exist");
  assert.ok(fs.existsSync(nextTaskPath), "engine-next-task.json should exist");

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  assert.equal(config.search.searchFlowVersion, "A");

  const nextTask = JSON.parse(fs.readFileSync(nextTaskPath, "utf-8"));
  assert.equal(nextTask.keyword, "테스트 키워드");
  assert.equal(nextTask.keywordName, "보조 키워드");

  const tasksText = fs.readFileSync(tasksPath, "utf-8");
  assert.ok(tasksText.includes("테스트 키워드"));
  assert.ok(tasksText.includes("보조 키워드"));
}

function testFlowCRequiresKeywordName(): void {
  const strategy: StrategyFile = {
    version: 1,
    name: "flow-c-invalid",
    runtime: {
      search: { searchFlowVersion: "C" },
    },
    tasks: [
      {
        keyword: "테스트",
        linkUrl: "https://smartstore.naver.com/example/products/1234567890",
      },
    ],
  };

  const validation = validateStrategy(strategy);
  assert.ok(validation.errors.some((error) => error.includes("flow C requires keywordName")));
}

function testTasksFormatterKeepsGuiCompatibility(): void {
  const text = formatTasksText([
    {
      checked: true,
      keyword: "키워드",
      linkUrl: "https://smartstore.naver.com/example/products/1234567890",
      mid: "1234567890",
      keywordName: "보조",
      targetCount: 2,
      productTitle: "",
      currentRank: "",
      startRank: "",
      trafficOk: 0,
      trafficFail: 0,
      yesterdayOk: 0,
      yesterdayFail: 0,
      reviewCount: "",
      starRating: "",
    },
  ]);

  assert.ok(text.startsWith("#date\t"));
  assert.ok(text.includes("검색키워드\t상품 URL\t2차키워드"));
}

testApplyStrategyWritesRuntimeFiles();
testFlowCRequiresKeywordName();
testTasksFormatterKeepsGuiCompatibility();

console.log("strategy-sync tests passed");
