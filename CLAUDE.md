# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Naver Shopping traffic automation runner. Reads task JSON from an external engine, drives a Patchright (Playwright fork) browser to perform Naver searches and product clicks, writes results back as JSON. No database — file-based I/O only.

## Commands

```bash
npm install
npm start              # continuous loop: poll engine-next-task.json, process, repeat
npm run once           # process exactly 1 task then exit (--once flag)
npm run build:worker   # esbuild bundle → worker-runner.js (for Electron GUI)
npm run build:gui-exe  # build:worker + Electron portable .exe
```

Run directly with tsx: `npx tsx unified-runner.ts [--once]`

## Architecture

### Task Flow

```
Engine (external)                    Runner (this repo)
─────────────────                    ──────────────────
writes engine-next-task.json  ──→   unified-runner.ts reads & deletes it
                              ←──   writes engine-last-result.json
```

File paths configurable via `engine-config.json` → `taskSource.taskFilePath` / `resultFilePath`, or env vars `ENGINE_TASK_FILE` / `ENGINE_RESULT_FILE`.

Schema examples: `engine-next-task.example.json`, `engine-last-result.example.json`

### Search Flow Versions (engine-config.json → search.searchFlowVersion)

- **A** (default): 1차 키워드 검색 → 2차 조합 키워드 검색 → 상품 클릭
- **B**: 메인 키워드만 검색 → 상품 클릭
- **C**: 2차 키워드만 검색 → 상품 클릭
- **D**: 쇼핑 순위 체크 모드 (rank-check-shopping.ts)

### Detection Bypass Layers

5-layer anti-detection stack (all in unified-runner.ts):
1. **Network** — IP rotation via ADB mobile data toggle or Windows adapter toggle (`ipRotation.ts`)
2. **Browser** — Patchright (bot-detection-resistant Playwright fork), system Chrome via `channel: 'chrome'`
3. **Device** — Dynamic UA/viewport matching real Chrome version (`shared/mobile-stealth.ts` detects installed Chrome version to sync sec-ch-ua headers)
4. **Session** — Fresh browser context per task, optional profile loading (`profiles/`)
5. **Behavior** — Bezier mouse movements, humanized typing delays, natural scrolling

### Key Files

| File | Role |
|------|------|
| `unified-runner.ts` | Main loop: task polling, browser lifecycle, all search flows (A/B/C/D), Naver login, product click |
| `engine-config.ts` | Loads `engine-config.json`, exports `EngineRuntime` with delays, proxy, UA, work mode |
| `ipRotation.ts` | IP rotation: ADB mobile data toggle (primary), Windows network adapter toggle (fallback) |
| `rank-check-shopping.ts` | Flow D: Naver integrated search → Shopping tab → find product rank by MID |
| `captcha/ReceiptCaptchaSolverPRB.ts` | Receipt CAPTCHA solver using Claude Vision API |
| `shared/mobile-stealth.ts` | Overrides navigator.userAgentData/platform/webdriver; detects real Chrome version for GREASE brand sync |
| `pw-version-override.ts` | Sets `PW_VERSION_OVERRIDE` env for GUI portable builds where patchright-core package.json is missing |
| `worker-runner.js` | esbuild bundle of unified-runner.ts (used by Electron GUI) |
| `traffic-engine-gui/` | Electron app that wraps worker-runner.js as a portable Windows .exe |

### Work Modes (engine-config.json → workMode)

- `mobile` (default): Mobile UA + viewport + touch emulation
- `desktop`: Desktop UA + standard viewport
- `random`: 50/50 per task

### Keyword Blacklist

Per-product (MID) blacklist of 2차 keyword combos stored at `data/keyword-blacklist.json` (configurable). When a combo fails to find the product, it's auto-appended to prevent retries.

### ADB Recovery Daemon

`ipRotation.ts` exports `startRecoveryDaemon()` / `stopRecoveryDaemon()`. When running, it calls `adb shell svc data enable` every 5 seconds silently — so when rotating IP via ADB, the runner only sends the OFF command and waits for the daemon to restore data automatically.

### esbuild `__name` Polyfill

esbuild injects `__name()` wrappers around arrow functions. Any `page.evaluate()` / `context.addInitScript()` call that runs bundled code in the browser context must first inject:
```js
(window).__name = (fn) => fn;
```
See usages in `rank-check-shopping.ts` and `unified-runner.ts`.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude Vision API for receipt CAPTCHA solving |
| `PARALLEL_BROWSERS` | Concurrent browser count (default 1, recommended 1 for file-queue) |
| `STARTUP_MOBILE_DATA_TOGGLE` | `false` to skip ADB data toggle on startup |
| `ENGINE_TASK_FILE` / `ENGINE_RESULT_FILE` | Override task/result JSON paths |
| `IP_ROTATION_METHOD` | `adb` / `adapter` / `auto` / `disabled` (default: auto) |
| `PW_VERSION_OVERRIDE` | Skip patchright-core version detection (GUI builds) |
| `SKIP_GIT_UPDATE_CHECK` | `1` to disable auto-restart on remote `main` updates (checked every 3 min) |

Naver login credentials: `naver-account.txt` (line 1: ID, line 2: password)

`.env` load order: `.env.local` → `.env` → `__dirname/.env` → `C:\turafic\.env` (first found wins)

## Tech Stack

- **Runtime**: Node.js 18+, TypeScript (tsx for dev, esbuild for production bundle)
- **Browser automation**: Patchright (primary), puppeteer-real-browser (connect helper)
- **CAPTCHA**: @anthropic-ai/sdk (Claude Vision)
- **GUI**: Electron 28 (traffic-engine-gui/)
- **No test framework configured**
