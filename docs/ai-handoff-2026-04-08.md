# AI Handoff 2026-04-08

## 이번 변경의 목적

Electron GUI 없이도 전략별 설정을 재현하고 테스트할 수 있게 만드는 것이 목표였다.
핵심은 전략 파일 하나를 기준으로 런타임 파일들을 동기화하는 것이다.

## 이번에 추가된 것

- `strategy-sync.ts`
  - 전략 JSON 스키마 정규화
  - 유효성 검증
  - `engine-config.json` 생성
  - GUI 호환 `traffic-engine-gui/tasks.txt` 생성
  - 러너 호환 `engine-next-task.json` 생성
- `scripts/strategy-cli.ts`
  - `check`, `apply` 제공
- `tests/strategy-sync.test.ts`
  - 기본 회귀 테스트
- `strategies/flow-a.json` ~ `strategies/flow-f.json`
  - 전략 템플릿
- `docs/strategy-workflow.md`
  - 운영 문서

## 현재 상태

- 기존 `unified-runner.ts` 실행 흐름은 수정하지 않았다.
- GUI와 전략 파일은 아직 양방향 동기화되지 않는다.
- 현재는 CLI가 전략 파일에서 런타임 파일을 생성하는 단방향 구조다.

## 다음 모델이 바로 볼 포인트

1. GUI를 전략 편집기로 바꾸고 싶다면:
   - `traffic-engine-gui/renderer.js`
   - `traffic-engine-gui/main.cjs`
   - `strategy-sync.ts`

2. 실제 실행 자동화를 붙이고 싶다면:
   - `npm run strategy:apply -- --strategy strategies/flow-a.json`
   - 그 다음 `npm run once` 또는 `npm start`

3. 더 안전하게 가려면:
   - 전략 파일 스키마를 JSON Schema로 분리
   - `buildEngineTask()` 에 `catalogMid`, `productTitle` 같은 확장 필드 옵션 추가
   - GUI의 import/export 버튼을 전략 파일 기준으로 연결

## 남은 리스크

- 템플릿 전략은 예시 URL을 사용하므로 실전 투입 전 값 교체가 필요하다.
- `targetCount` 는 비-D 흐름에서 경고만 하고 강제하지 않는다.
- `tasks.txt` 포맷은 현재 GUI 코드 기준으로 맞췄다. GUI 컬럼이 바뀌면 `strategy-sync.ts` 도 같이 수정해야 한다.

## 빠른 확인 명령

```bash
npm run strategy:test
npm run strategy:check -- --strategy strategies/flow-a.json
npm run strategy:apply -- --strategy strategies/flow-a.json --output .omx/tmp/flow-a
npx tsc --noEmit
```
