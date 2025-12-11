# Mass Replay Engine

대량의 요청을 각각 다른 사용자처럼 보이게 동시에 전송하는 시스템.

## 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     High-Throughput Packet Replay System                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐     ┌─────────────────────────────────────────────┐   │
│  │   Task DB   │────▶│              Orchestrator                    │   │
│  │  (Supabase) │     │  - 작업 분배, 속도 조절, 결과 집계          │   │
│  └─────────────┘     └──────────────────┬──────────────────────────┘   │
│                                         │                               │
│                    ┌────────────────────┼────────────────────┐          │
│                    ▼                    ▼                    ▼          │
│  ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐│
│  │    Worker 1         │ │    Worker 2         │ │    Worker N         ││
│  └──────────┬──────────┘ └──────────┬──────────┘ └──────────┬──────────┘│
│             │                       │                       │           │
│             ▼                       ▼                       ▼           │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                    Identity Generator Pool                          ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  ││
│  │  │ IP Pool  │ │  Device  │ │ Session  │ │  Header  │ │  Timing  │  ││
│  │  │ (Proxy)  │ │ Profiles │ │ Cookies  │ │ Builder  │ │ Variance │  ││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                    │                                    │
│                                    ▼                                    │
│           ┌────────────────────────────────────────────┐                │
│           │  smartstore.naver.com/i/v1/product-logs    │                │
│           │  wcs.naver.com/b                           │                │
│           │  nlog.naver.com/n                          │                │
│           └────────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────────────┘
```

## 핵심 구성요소

### 1. MassReplayEngine
- 전체 실행 조율
- Worker Pool 관리
- Rate Limiting
- 결과 집계

### 2. IdentityGenerator
- 매 요청마다 **고유한** 사용자 신원 생성
- User-Agent 다양화 (Windows/Mac/Mobile)
- Device Fingerprint 생성 (deviceId, fwb, nac)
- Screen Resolution / Hardware Profile 랜덤화

### 3. ProxyPool
- 프록시 로테이션 관리
- 선택 전략: round-robin, random, least-used, performance
- 실패 시 자동 블랙리스트
- 성공률/지연시간 기반 최적화

### 4. RequestBuilder
- 실제 네이버 요청 형식 재현
- 엔드포인트별 헤더/바디 생성
- Client Hints, sec-ch-ua 등 최신 헤더

## 사용법

### 기본 사용

```typescript
import { MassReplayEngine } from "./engines-packet/mass-replay";

const engine = new MassReplayEngine({
  concurrency: 50,           // 동시 워커 수
  maxRequestsPerSecond: 100, // 속도 제한
  proxyPool: proxies,        // 프록시 목록
  rotateProxyEvery: 5,       // N 요청마다 프록시 변경
  minDelayMs: 100,           // 최소 요청 간격
  maxDelayMs: 500,           // 최대 요청 간격
  dwellTimeRange: [5000, 15000], // 체류 시간 범위
});

const tasks = [
  { productId: "123", merchantId: "456", channelNo: "789", categoryId: "1000" },
  // ...
];

const results = await engine.execute(tasks);
```

### 프록시 설정

환경변수로 설정:
```bash
PROXY_LIST=http://user:pass@host:port,socks5://host:port,...
```

또는 직접 전달:
```typescript
const proxies = [
  { host: "1.2.3.4", port: 8080, type: "http", category: "residential" },
  { host: "5.6.7.8", port: 1080, type: "socks5", category: "mobile" },
];

const engine = new MassReplayEngine({ proxyPool: proxies });
```

## 다양성 확보 전략

### IP 다양성
- 프록시 풀 사용 (Residential / Mobile / Datacenter)
- N 요청마다 자동 로테이션
- 실패 시 자동 블랙리스트 및 대체

### 디바이스 다양성
- OS 분포: Windows 70%, Mac 20%, Mobile 10% (조정 가능)
- 30+ User-Agent 풀
- 8+ Screen Resolution 풀
- Hardware Profile 다양화

### 세션 다양성
- 매 요청마다 새 deviceId 생성
- fwb (fingerprint) 랜덤 생성
- 쿠키 없음 (신규 방문자)

### 타이밍 다양성
- 요청 간격 랜덤 (min~max)
- 체류 시간 랜덤 (dwellTimeRange)
- Rate Limiting으로 burst 방지

## 성능 지표

| 설정 | 예상 처리량 |
|-----|-----------|
| 50 Workers, 100 req/s | ~100 req/s |
| 100 Workers, 200 req/s | ~200 req/s |
| 200 Workers, 500 req/s | ~500 req/s |

※ 실제 처리량은 네트워크, 프록시 품질, 서버 응답에 따라 다름

## 주의사항

1. **프록시 품질**: Residential/Mobile 프록시 권장
2. **속도 조절**: 너무 빠르면 탐지 위험 증가
3. **모니터링**: 성공률 지속 모니터링 필요
4. **분산 실행**: 대량 처리 시 여러 서버에서 분산 권장

## 테스트

```bash
# 기본 테스트 (프록시 없이)
npx tsx scripts/test-mass-replay.ts

# 프록시와 함께
PROXY_LIST=http://user:pass@proxy1:8080,http://user:pass@proxy2:8080 \
npx tsx scripts/test-mass-replay.ts
```
