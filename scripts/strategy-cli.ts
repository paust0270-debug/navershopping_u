import * as path from "path";
import {
  applyStrategyToDirectory,
  loadStrategyFile,
  normalizeStrategy,
  validateStrategy,
} from "../strategy-sync";

function printUsage(): void {
  console.log("Usage:");
  console.log("  npx tsx scripts/strategy-cli.ts check --strategy <path>");
  console.log("  npx tsx scripts/strategy-cli.ts apply --strategy <path> [--output <dir>] [--task-index <n>] [--no-next-task]");
}

function getFlag(name: string, args: string[]): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string, args: string[]): boolean {
  return args.includes(name);
}

function resolveStrategyPath(input: string | undefined): string {
  if (!input) {
    throw new Error("Missing --strategy <path>.");
  }
  return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}

function printValidationSummary(strategyPath: string): number {
  const strategy = loadStrategyFile(strategyPath);
  const normalized = normalizeStrategy(strategy);
  const validation = validateStrategy(strategy);
  const flow = normalized.runtime.search?.searchFlowVersion || "A";

  console.log(`[strategy] ${normalized.name}`);
  console.log(`[flow] ${flow}`);
  console.log(`[tasks] total=${normalized.tasks.length} checked=${normalized.tasks.filter((task) => task.checked).length}`);

  if (validation.warnings.length > 0) {
    console.log("[warnings]");
    for (const warning of validation.warnings) {
      console.log(`- ${warning}`);
    }
  }

  if (validation.errors.length > 0) {
    console.log("[errors]");
    for (const error of validation.errors) {
      console.log(`- ${error}`);
    }
    return 1;
  }

  console.log("[status] valid");
  return 0;
}

function run(): number {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return 0;
  }

  const strategyPath = resolveStrategyPath(getFlag("--strategy", args));

  if (command === "check") {
    return printValidationSummary(strategyPath);
  }

  if (command === "apply") {
    const outputDir = path.resolve(process.cwd(), getFlag("--output", args) || ".");
    const taskIndex = Number(getFlag("--task-index", args) || "0");
    const writeNextTask = !hasFlag("--no-next-task", args);
    const strategy = loadStrategyFile(strategyPath);
    const validation = validateStrategy(strategy);

    if (validation.warnings.length > 0) {
      for (const warning of validation.warnings) {
        console.log(`[warn] ${warning}`);
      }
    }

    const result = applyStrategyToDirectory(strategy, outputDir, {
      taskIndex: Number.isFinite(taskIndex) ? taskIndex : 0,
      writeNextTask,
    });

    console.log(`[config] ${result.configPath}`);
    console.log(`[tasks] ${result.tasksPath}`);
    if (result.nextTaskPath) {
      console.log(`[next-task] ${result.nextTaskPath}`);
    }
    if (result.selectedTask) {
      console.log(`[selected] ${result.selectedTask.keyword} -> ${result.selectedTask.mid}`);
    }
    return 0;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  process.exitCode = run();
} catch (error: any) {
  console.error(error?.message || String(error));
  process.exitCode = 1;
}
