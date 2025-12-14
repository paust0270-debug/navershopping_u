# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**TURAFIC Update** is an automated traffic generation system for Naver (Korean search engine) product pages. It runs browser automation across remote Windows PCs with automatic code updates from GitHub.

**Tech Stack**: TypeScript, Patchright/Playwright, Supabase, Claude Vision API (for CAPTCHA solving)

## Development Commands

```bash
# Run unified worker (main traffic runner)
npx tsx unified-runner.ts

# Run slot-naver runner (Supabase slot_naver 기반)
npx tsx scripts/slot-naver-runner.ts
npx tsx scripts/slot-naver-runner.ts --test      # 테스트 모드 (100회/슬롯)
npx tsx scripts/slot-naver-runner.ts --headless  # 헤드리스 모드

# Run test runner (5 product test)
npx tsx runner/test-runner.ts

# Run production runner
npx tsx runner/production-runner.ts

# Build commands
npm run build:worker       # Build worker-runner.js (esbuild)
npm run build:launcher     # Build launcher.js
npm run build:all          # Build everything

# Build executables (pkg)
npm run build:exe           # turafic-updater.exe
npm run build:launcher-exe  # turafic-launcher.exe

# PM2 scheduler management
npx pm2 start ecosystem.config.js
npx pm2 list
npx pm2 logs turafic-sinzimoru
npx pm2 restart all
```

## Architecture

### System Layers

```
┌─────────────────────────────────────────────────────────┐
│  1. Network Layer                                        │
│     - ipRotation.ts: IP rotation via ADB/adapter         │
│     - getCurrentIP(), rotateIP()                         │
├─────────────────────────────────────────────────────────┤
│  2. Browser Layer                                        │
│     - Patchright (Playwright fork for bot detection)     │
│     - 4 parallel browser instances in grid layout        │
├─────────────────────────────────────────────────────────┤
│  3. Device Layer                                         │
│     - profiles/*.json: UserAgent, viewport, fingerprint  │
│     - channel: 'chrome' uses system Chrome               │
├─────────────────────────────────────────────────────────┤
│  4. Behavior Layer                                       │
│     - Bezier curve mouse movement (cubicBezier)          │
│     - Humanized typing with random delays                │
│     - mouse.wheel scrolling (not scrollBy)               │
└─────────────────────────────────────────────────────────┘
```

### Core Files

| File | Purpose |
|------|---------|
| `unified-runner.ts` | Main worker: fetches tasks from Supabase, runs browser automation |
| `scripts/slot-naver-runner.ts` | **Slot 기반 러너**: slot_naver 테이블에서 작업 획득/처리 |
| `engines/v7_engine.ts` | Traffic engine: search, scroll, click, CAPTCHA handling |
| `engines-packet/` | Packet replay 엔진 (BehaviorLogCaptor, MultiSendEngine) |
| `ipRotation.ts` | IP rotation via ADB (mobile tethering) or network adapter |
| `captcha/ReceiptCaptchaSolverPRB.ts` | CAPTCHA solver using Claude Vision API |
| `auto-updater.ts` | Auto-updates from GitHub every 3 minutes |
| `launcher.ts` | Launcher that manages the worker process |
| `config.ts` | Configuration loader (env > DB > config.json > defaults) |

### Data Flow

1. **auto-updater.exe** checks GitHub `version.json` every 3 minutes
2. Downloads `worker-runner.js` if version changed
3. **worker-runner.js** connects to Supabase, gets active mode and products
4. Launches 4 parallel browsers in grid layout
5. Each browser: Naver search -> scroll -> click product -> verify MID
6. CAPTCHA detected -> Claude Vision solves it
7. IP rotation every 5 batches (20 tasks)

### Supabase Tables

**Control DB** (navertrafictest):
- `traffic_mode_settings`: Active modes (tonggum_login, shogum_nologin, etc.)
- `workerNodes`: Worker status, heartbeat, version

**Production DB** (adpang_production):
- `slot_naver`: **핵심 테이블** - 슬롯 기반 작업 관리
  ```
  id, keyword, mid, product_name, status
  worker_lock      # 워커 잠금 (동시 접근 방지)
  locked_at        # 잠금 시간 (60분 타임아웃)
  success_count    # 오늘 성공 횟수
  fail_count       # 오늘 실패 횟수
  last_reset_date  # 일일 리셋 날짜
  ```

### Slot-Naver Runner 작업 흐름

1. `acquireMultipleSlots(4)`: 4개 슬롯 동시 획득 (worker_lock 설정)
2. 각 브라우저가 독립적으로 슬롯 처리:
   - 네이버 검색 → MID 상품 찾기 → 클릭
   - `BehaviorLogCaptor`로 product-logs 캡처
   - `MultiSendEngine`으로 100회 시퀀스 전송
3. 완료 후 `releaseSlot()`: 잠금 해제, success/fail_count 업데이트
4. 1시간마다 IP 로테이션

## Environment Variables

```env
# Required
SUPABASE_PRODUCTION_URL=    # Production DB URL
SUPABASE_PRODUCTION_KEY=    # Production DB anon key
EQUIPMENT_NAME=             # PC identifier in task queue

# Optional
SUPABASE_CONTROL_URL=       # Control DB for mode settings
SUPABASE_CONTROL_KEY=       # Control DB key
ANTHROPIC_API_KEY=          # For CAPTCHA solving
IP_ROTATION_METHOD=auto     # adb | adapter | auto | disabled
NETWORK_CAPTURE=true        # Enable network request logging
```

## Key Implementation Details

### Browser Automation Pattern

The system uses Patchright (a Playwright fork) with bot detection bypass:

```typescript
import { chromium } from "patchright";

const browser = await chromium.launch({
  channel: 'chrome',  // Use system Chrome
  headless: false,
  args: ['--window-position=0,0', '--window-size=940,520']
});
```

### Humanized Behavior

Mouse movements use Bezier curves to avoid detection:
- `bezierMouseMove()`: Curved path with easing
- `humanizedType()`: Random delays 30-60ms between keystrokes
- `humanScroll()`: mouse.wheel instead of scrollBy (detectable)

### CAPTCHA Handling

Receipt CAPTCHA on Naver uses Claude Vision:
1. Detect CAPTCHA page (keywords: "보안 확인", "영수증 번호")
2. Screenshot `#rcpt_img` element
3. Send to Claude Vision API for answer
4. Type answer with humanized input

### IP Rotation

Two methods supported:
- **ADB**: Toggle mobile data on USB-connected phone (`svc data disable/enable`)
- **Adapter**: Disable/enable Windows network adapter via `netsh`

Recovery daemon runs every 5s to ensure data stays enabled.

## File Structure

```
turafic_update/
├── unified-runner.ts      # Main worker (builds to worker-runner.js)
├── engines/
│   └── v7_engine.ts       # Traffic engine with CAPTCHA handling
├── engines-packet/        # Packet replay 엔진
│   ├── capture/
│   │   └── BehaviorLogCaptor.ts  # 행동 로그 캡처
│   ├── builders/
│   │   └── BehaviorLogBuilder.ts # 로그 빌더
│   └── replay/
│       └── MultiSendEngine.ts    # product-logs POST 전송
├── captcha/
│   └── ReceiptCaptchaSolverPRB.ts  # Claude Vision CAPTCHA solver
├── runner/
│   ├── test-runner.ts     # Test runner (5 products)
│   ├── production-runner.ts
│   └── types.ts           # Shared type definitions
├── scripts/
│   ├── slot-naver-runner.ts      # **Slot 기반 메인 러너**
│   ├── scheduler-*.ts            # PM2 schedulers per product
│   └── mass-rotation-runner.ts   # Batch runner with IP rotation
├── profiles/
│   └── pc_v7.json         # Browser profile (viewport, fingerprint)
├── ipRotation.ts          # IP rotation module
├── config.ts              # Configuration loader
├── auto-updater.ts        # GitHub auto-update
├── launcher.ts            # Process launcher
└── ecosystem.config.js    # PM2 configuration
```

## Deployment

Remote PCs run `turafic-launcher.exe` which:
1. Pulls latest code from GitHub
2. Starts `worker-runner.js`
3. Restarts on crash or update

Update workflow:
```bash
npm run build:worker
# Update version.json
git add worker-runner.js version.json
git push
# Remote PCs auto-update within 3 minutes
```
