# Strategy Workflow

GUI 없이 전략별 실행 구성을 재현하기 위한 파일 기반 워크플로우다.

## 목적

- 전략 A~F를 `strategies/*.json` 한 곳에서 관리한다.
- Electron GUI를 켜지 않고도 `engine-config.json`, `traffic-engine-gui/tasks.txt`, `engine-next-task.json` 을 생성한다.
- 다음 모델이나 작업자가 동일한 입력으로 같은 런타임 파일을 다시 만들 수 있게 한다.

## 핵심 파일

- `strategy-sync.ts`
  - 전략 파일 검증
  - GUI 호환 `tasks.txt` 생성
  - 러너 호환 `engine-next-task.json` 생성
- `scripts/strategy-cli.ts`
  - `check` 와 `apply` CLI 진입점
- `strategies/flow-a.json` ~ `strategies/flow-f.json`
  - 전략 템플릿

## 전략 파일 스키마

```json
{
  "version": 1,
  "name": "flow-a-template",
  "description": "optional",
  "runtime": {
    "workMode": "mobile",
    "search": {
      "searchFlowVersion": "A",
      "maxScrollAttempts": 4
    },
    "taskSource": {
      "taskFilePath": "engine-next-task.json",
      "resultFilePath": "engine-last-result.json"
    }
  },
  "tasks": [
    {
      "checked": true,
      "keyword": "메인 키워드",
      "linkUrl": "https://smartstore.naver.com/example/products/1234567890",
      "keywordName": "2차 키워드",
      "targetCount": 10
    }
  ]
}
```

## 명령어

검증:

```bash
npm run strategy:check -- --strategy strategies/flow-a.json
```

적용:

```bash
npm run strategy:apply -- --strategy strategies/flow-a.json
```

특정 출력 폴더:

```bash
npm run strategy:apply -- --strategy strategies/flow-a.json --output .omx/tmp/flow-a
```

`engine-next-task.json` 생성 생략:

```bash
npm run strategy:apply -- --strategy strategies/flow-a.json --no-next-task
```

체크된 두 번째 작업을 next-task로 선택:

```bash
npm run strategy:apply -- --strategy strategies/flow-a.json --task-index 1
```

회귀 테스트:

```bash
npm run strategy:test
```

## 동작 규칙

- `linkUrl` 은 반드시 `/products/<숫자MID>` 형태를 포함해야 한다.
- flow `C` 는 `keywordName` 이 필수다.
- flow `D` 는 `targetCount` 없이도 허용한다.
- flow `A/B/C/E/F` 는 GUI 무한 실행과 맞추기 위해 `targetCount > 0` 를 권장한다. 현재는 경고만 낸다.
- `tasks.txt` 는 GUI의 `save-task-rows-text` 포맷과 동일한 컬럼 순서를 유지한다.

## 운영 권장

- 실사용 전에는 템플릿 JSON의 키워드, URL, 목표 수치를 실제 값으로 바꾼다.
- 전략 템플릿은 Git에 남기고, 실계정/실상품 전략은 별도 비공개 파일로 관리한다.
- GUI는 앞으로 이 전략 파일을 읽고 저장하는 편집기로 수렴시키는 것이 좋다. 현재 구현은 CLI 기준이다.
