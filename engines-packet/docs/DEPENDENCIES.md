# Dependencies & File Structure

> 파일 의존성 및 폴더 구조 가이드

## 프로젝트 폴더 구조

```mermaid
graph TB
    subgraph "turafic_update (메인)"
        UR[unified-runner.ts<br/>Production 실행]
        V7[engines/v7_engine.ts<br/>기존 엔진]
        IP[ipRotation.ts<br/>IP 로테이션]
        CAP[captcha/*<br/>CAPTCHA 모듈]
    end

    subgraph "engines-packet (패킷 엔진)"
        PE[PacketEngine.ts]
        AN[analysis/*]
        SE[session/*]
        RE[replay/*]
        HY[hybrid/*]
        BU[builders/*]
        VE[verification/*]
    end

    UR --> V7
    UR --> IP
    UR --> CAP
    V7 -.->|향후 통합| PE

    style UR fill:#e3f2fd
    style PE fill:#fff8e1
```

---

## 파일별 의존성 맵

### 1. unified-runner.ts (Production)

```mermaid
graph TB
    UR[unified-runner.ts]

    subgraph "External"
        PR[patchright]
        SB[supabase-js]
        DOT[dotenv]
    end

    subgraph "Internal"
        IP[ipRotation.ts]
    end

    subgraph "5계층 로직 (내장)"
        L1[네트워크 계층]
        L2[브라우저 계층]
        L3[디바이스 계층]
        L4[세션 계층]
        L5[행동 계층]
    end

    UR --> PR
    UR --> SB
    UR --> DOT
    UR --> IP

    UR --> L1
    UR --> L2
    UR --> L3
    UR --> L4
    UR --> L5

    style UR fill:#e3f2fd
```

### 2. PacketEngine.ts

```mermaid
graph TB
    PE[PacketEngine.ts]

    subgraph "Analysis"
        HAR[HarConverter]
        PA[PatternAnalyzer]
        TA[TimingAnalyzer]
    end

    subgraph "Session"
        SM[SessionManager]
        HB[HeaderBuilder]
        CE[CookieExtractor]
        DIG[DeviceIdGenerator]
    end

    subgraph "Replay"
        RR[RequestReplayer]
        BF[BrowserFetch]
        TS[TimingSimulator]
        RQ[RequestQueue]
    end

    subgraph "Hybrid"
        HC[HybridContext]
        BS[BrowserSync]
    end

    PE --> HC
    PE --> SM
    PE --> RR

    HC --> BS
    HC --> BF

    RR --> RQ
    RR --> TS
    RR --> BF

    SM --> CE
    SM --> HB
    HB --> DIG

    style PE fill:#fff8e1
```

### 3. 행동 로그 빌더

```mermaid
graph TB
    subgraph "Builders"
        PLB[ProductLogBuilder]
        BLB[BehaviorLogBuilder]
    end

    subgraph "Dependencies"
        HB[HeaderBuilder]
        DIG[DeviceIdGenerator]
        TS[TimingSimulator]
    end

    subgraph "Output"
        VP[viewProduct 로그]
        SC[scroll 로그]
        DW[dwell 로그]
        EX[expose 로그]
    end

    PLB --> HB
    PLB --> DIG
    BLB --> HB
    BLB --> TS

    PLB --> VP
    BLB --> SC
    BLB --> DW
    BLB --> EX

    style PLB fill:#c8e6c9
    style BLB fill:#c8e6c9
```

---

## Production vs Test 환경

```mermaid
graph TB
    subgraph "Production (unified-runner.ts)"
        P_5L[5계층 로직 ✅]
        P_IP[IP Rotation ✅]
        P_CAP[CAPTCHA Solver ✅]
        P_PAR[병렬 브라우저 ✅]
        P_DEL[브라우저 지연 ✅]
        P_DB[Supabase DB ✅]
    end

    subgraph "Test 환경"
        T_5L[5계층 로직 ✅]
        T_IP[IP Rotation ❌]
        T_CAP[CAPTCHA Solver ❌]
        T_PAR[병렬 브라우저 ❌]
        T_DEL[브라우저 지연 ❌]
        T_DB[로컬 로그 ✅]
    end

    style P_5L fill:#c8e6c9
    style T_5L fill:#c8e6c9
    style P_IP fill:#bbdefb
    style P_CAP fill:#bbdefb
    style P_PAR fill:#bbdefb
    style P_DEL fill:#bbdefb
    style T_IP fill:#ffcdd2
    style T_CAP fill:#ffcdd2
    style T_PAR fill:#ffcdd2
    style T_DEL fill:#ffcdd2
```

### 공유 vs 분리 모듈

| 모듈 | Production | Test | 비고 |
|------|------------|------|------|
| 5계층 로직 | ✅ | ✅ | **동일해야 함** |
| 베지어 마우스 | ✅ | ✅ | **동일해야 함** |
| 인간화 타이핑 | ✅ | ✅ | **동일해야 함** |
| 헤더 생성 | ✅ | ✅ | **동일해야 함** |
| IP Rotation | ✅ | ❌ | Production만 |
| CAPTCHA Solver | ✅ | ❌ | Production만 |
| 병렬 브라우저 | ✅ | ❌ | Production만 |
| Supabase | ✅ | ❌ | Production만 |

---

## 폴더 정리 방안

### 현재 구조

```
D:\Project\
├── turafic_update/      # 메인 (Production)
├── patch-right/         # Patchright 테스트
└── navertrafic/         # 이전 버전 (deprecated?)
```

### 권장 구조

```mermaid
graph TB
    subgraph "D:\Project\"
        TU[turafic_update/<br/>메인 Production]
        TE[turafic_test/<br/>테스트 환경]
        AR[turafic_archive/<br/>버전 백업]
    end

    subgraph "turafic_update/"
        UR[unified-runner.ts]
        EP[engines-packet/]
        EN[engines/]
        RU[runner/]
    end

    subgraph "turafic_test/"
        TT[test-*.ts]
        SC[scripts/]
    end

    subgraph "turafic_archive/"
        V1[v1.0_2024-12-01/]
        V2[v1.1_2024-12-10/]
    end

    TU --> TE
    TU --> AR

    style TU fill:#c8e6c9
    style TE fill:#fff8e1
    style AR fill:#e1bee7
```

### 폴더별 역할

| 폴더 | 역할 | Git 관리 |
|------|------|----------|
| `turafic_update/` | Production 코드 | ✅ main 브랜치 |
| `turafic_test/` | 테스트 코드 | ✅ test 브랜치 |
| `turafic_archive/` | 버전 백업 | ❌ 로컬만 |
| `patch-right/` | 폐기 또는 통합 | ❌ |
| `navertrafic/` | 폐기 | ❌ |

---

## Import 구조

### engines-packet 내부

```typescript
// PacketEngine.ts
import { HybridContext } from "./hybrid/HybridContext";
import { SessionManager } from "./session/SessionManager";
import { RequestReplayer } from "./replay/RequestReplayer";

// HybridContext.ts
import { BrowserSync } from "./BrowserSync";
import { BrowserFetch } from "../replay/BrowserFetch";

// SessionManager.ts
import { CookieExtractor } from "./CookieExtractor";
import { HeaderBuilder } from "./HeaderBuilder";

// HeaderBuilder.ts
import { DeviceIdGenerator } from "./DeviceIdGenerator";
```

### 외부에서 사용

```typescript
// unified-runner.ts 또는 test 파일
import {
  PacketEngine,
  ProductLogBuilder,
  BehaviorLogBuilder,
  BrowserFetch,
} from "./engines-packet";
```

---

## 변경 추적 가이드

### Git 커밋 메시지 규칙

```
[계층] 변경내용

예시:
[L1-Network] TLS fingerprint 검증 추가
[L2-Browser] Client Hints 버전 업데이트
[L3-Device] deviceMemory 값 조정
[L4-Session] 쿠키 만료 처리 개선
[L5-Behavior] 스크롤 패턴 수정
[Hybrid] BrowserFetch 타임아웃 조정
[Test] viewProduct 테스트 추가
```

### 변경 영향도 체크리스트

```
□ L1 변경 → TLS/IP 관련 테스트 필요
□ L2 변경 → 브라우저 탐지 테스트 필요
□ L3 변경 → fingerprint 일관성 확인
□ L4 변경 → 세션 유지 테스트 필요
□ L5 변경 → 행동 패턴 테스트 필요
□ Hybrid 변경 → 전체 플로우 테스트
```

---

## Version History

| 날짜 | 버전 | 변경사항 |
|------|------|---------|
| 2024-12-11 | v1.0 | 초기 문서 작성 |
