# Packet Engine 변경 내역 (2025-12-11)

## 개요

패킷 기반 자동화 엔진 시스템. 브라우저 행동을 캡처하고, 캡처된 템플릿을 기반으로 대량의 요청을 재전송하는 방식.

## 신규 추가 모듈

### 1. engines-packet/ (핵심 패킷 엔진)
| 파일 | 설명 |
|------|------|
| `PacketEngine.ts` | 메인 엔진 클래스 - 브라우저 + 패킷 통합 |
| `types.ts` | 타입 정의 |
| `index.ts` | 모듈 export |

### 2. engines-packet/replay/ (리플레이 시스템)
| 파일 | 설명 |
|------|------|
| `RequestReplayer.ts` | 요청 리플레이어 - page.evaluate(fetch) 기반 |
| `MultiSendEngine.ts` | 다중 전송 엔진 - 배치 전송 + 지터 |
| `TimingSimulator.ts` | 타이밍 시뮬레이터 - 인간 행동 모방 |
| `RequestQueue.ts` | 요청 큐 - 순서 보장 |
| `BrowserFetch.ts` | Chrome TLS fetch - 브라우저 내 fetch 실행 |

### 3. engines-packet/hybrid/ (하이브리드 컨텍스트)
| 파일 | 설명 |
|------|------|
| `HybridContext.ts` | 브라우저 + 패킷 통합 컨텍스트 |
| `BrowserSync.ts` | 브라우저 ↔ SessionManager 동기화 |

### 4. engines-packet/session/ (세션 관리)
| 파일 | 설명 |
|------|------|
| `SessionManager.ts` | 세션 상태 관리 (쿠키, NAC, NACT) |
| `CookieExtractor.ts` | 쿠키 추출 |
| `HeaderBuilder.ts` | 헤더 빌더 - UA, sec-ch-ua 일치 |
| `DeviceIdGenerator.ts` | 디바이스 ID/fingerprint 생성 |

### 5. engines-packet/builders/ (패킷 빌더)
| 파일 | 설명 |
|------|------|
| `ProductLogBuilder.ts` | product-logs API 빌더 (조회수 핵심) |
| `BehaviorLogBuilder.ts` | 행동 로그 빌더 (scroll, expose, dwell) |

### 6. engines-packet/capture/ (로그 캡처)
| 파일 | 설명 |
|------|------|
| `BehaviorLogCaptor.ts` | 행동 로그 캡처 (네트워크 요청 감시) |

### 7. engines-packet/mass-replay/ (대량 리플레이)
| 파일 | 설명 |
|------|------|
| `MassReplayEngine.ts` | 대량 처리 엔진 - 워커 풀 + rate limiting |
| `IdentityGenerator.ts` | 사용자 identity 생성 - UA, deviceId, fwb, nac |
| `ProxyPool.ts` | 프록시 풀 - 로테이션, 헬스 체크 |
| `RequestBuilder.ts` | 요청 빌더 - product-logs body 생성 |

### 8. engines-packet/analysis/ (분석 도구)
| 파일 | 설명 |
|------|------|
| `PatternAnalyzer.ts` | 패턴 분석 - 성공/실패 요청 비교 |
| `HarConverter.ts` | HAR 파일 변환 |
| `TimingAnalyzer.ts` | 타이밍 분석 |

### 9. engines-packet/verification/ (검증)
| 파일 | 설명 |
|------|------|
| `NaverLogMonitor.ts` | 네이버 로그 모니터 |
| `TLSVerifier.ts` | TLS fingerprint 검증 |
| `CookieChainVerifier.ts` | 쿠키 체인 검증 |

### 10. engines-packet/rank_checker/ (순위 체커)
| 파일 | 설명 |
|------|------|
| `RankChecker.ts` | 네이버 쇼핑 순위 조회 |
| `MidExtractor.ts` | 상품 MID 추출 |
| `PageParser.ts` | 검색 결과 파싱 |

## 테스트 스크립트

| 파일 | 설명 | 사용법 |
|------|------|--------|
| `scripts/test-productlog-replay.ts` | 단일 상품 리플레이 테스트 | `npx tsx scripts/test-productlog-replay.ts "키워드" "MID" 10` |
| `scripts/test-mass-replay.ts` | 대량 리플레이 테스트 | `npx tsx scripts/test-mass-replay.ts` |

## 핵심 기술

### Chrome TLS 보장
- `page.evaluate(fetch)` 사용 → 브라우저 내 fetch 실행
- `page.request.fetch()`는 Node TLS를 쓸 수 있어 사용 금지
- 실제 Chrome의 TLS fingerprint 유지

### 노이즈 적용
- `x-client-version`: 현재 시간 + 랜덤 초
- `ackey`: 랜덤 8자리
- `timestamp`: 현재 시간 + 랜덤 오프셋
- `scrollY`, `dwellTime` 등 값 랜덤화

### Client Hints 일치 (중요)
```
User-Agent: Chrome/131 + Windows NT
    ↕ 반드시 일치
sec-ch-ua: v="131"
sec-ch-ua-platform: "Windows"
sec-ch-ua-arch: "x86"
```

## 다음 작업 예정

- [ ] ProfileManager - 다중 프로필 로테이션 (launchPersistentContext)
- [ ] BatchScheduler - 배치 스케줄링 (랜덤 서브배치)
- [ ] mass-rotation-runner - 1000회 자동화 스크립트
- [ ] scheduled-runner - cron 스케줄러

## 의존성

```json
{
  "patchright": "^1.x",
  "playwright-extra": "^4.x",
  "puppeteer-extra-plugin-stealth": "^2.x",
  "node-cron": "^3.x"
}
```
