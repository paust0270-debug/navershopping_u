# CLAUDE.md

엔진 JSON ↔ 브라우저 자동화만 사용 (**Supabase/DB 없음**).

## 실행

```bash
npm install
npm start
npm run once
```

## 입출력

| 파일 | 역할 |
|------|------|
| `engine-next-task.json` | 엔진이 **작성** — 러너가 읽고 삭제 후 처리 |
| `engine-last-result.json` | 러너가 **작업 완료 시 덮어씀** — 엔진이 `ok`, `failReason` 등 표시용 |

경로: `engine-config.json` → `taskSource.taskFilePath` / `resultFilePath`, 또는 환경변수 `ENGINE_TASK_FILE`, `ENGINE_RESULT_FILE`.

작업 JSON 스키마: `engine-next-task.example.json`  
결과 JSON 스키마: `engine-last-result.example.json`

## 코드

| 파일 | 역할 |
|------|------|
| `unified-runner.ts` | 메인 루프 |
| `engine-config.ts` / `engine-config.json` | 딜레이, UA, 프록시, 입출력 경로 |
| `ipRotation.ts` | 공인 IP, ADB 데이터 토글 |
| `captcha/ReceiptCaptchaSolverPRB.ts` | Claude CAPTCHA |
| `shared/mobile-stealth.ts` | 모바일 컨텍스트 |
| `profiles/pc_v7.json` | 프로필(선택) |

## 환경변수 (선택)

- `ANTHROPIC_API_KEY` — 검색 CAPTCHA
- `PARALLEL_BROWSERS` — 기본 1 권장 (파일 큐 1개)
- `STARTUP_MOBILE_DATA_TOGGLE`, `ENGINE_TASK_FILE`, `ENGINE_RESULT_FILE`
- 로그인: `naver-account.txt` (1줄 ID, 2줄 비밀번호)
