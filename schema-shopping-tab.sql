-- ============================================================
-- Shopping Tab Runner 데이터베이스 스키마
-- ============================================================
-- 실행 방법: Supabase SQL Editor에서 전체 실행
-- 생성 테이블: 8개 (큐 2개, 통계 2개, 히스토리 2개 + 기존 2개 유지)
-- ============================================================

-- ============ 1. 트래픽 큐 테이블 ============

-- 운영 큐
CREATE TABLE IF NOT EXISTS traffic_navershopping-app (
  id bigserial PRIMARY KEY,
  slot_id bigint,
  keyword text,
  link_url text,
  slot_type text DEFAULT '네이버쇼핑',
  customer_id text,
  created_at timestamp DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traffic_navershopping-app_slot_type
ON "traffic_navershopping-app"(slot_type);

CREATE INDEX IF NOT EXISTS idx_traffic_navershopping-app_created_at
ON "traffic_navershopping-app"(created_at);

COMMENT ON TABLE "traffic_navershopping-app" IS '운영 트래픽 큐 - 쇼핑탭 러너용';

-- 테스트 큐
CREATE TABLE IF NOT EXISTS traffic_navershopping-test (
  id bigserial PRIMARY KEY,
  slot_id bigint,
  keyword text,
  link_url text,
  slot_type text DEFAULT '네이버쇼핑',
  customer_id text,
  created_at timestamp DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traffic_navershopping-test_slot_type
ON "traffic_navershopping-test"(slot_type);

CREATE INDEX IF NOT EXISTS idx_traffic_navershopping-test_created_at
ON "traffic_navershopping-test"(created_at);

COMMENT ON TABLE "traffic_navershopping-test" IS '테스트 트래픽 큐 - 쇼핑탭 러너용';

-- ============ 2. 통계 테이블 (Slot 관리) ============

-- 운영 통계
CREATE TABLE IF NOT EXISTS slot_naverapp (
  id bigserial PRIMARY KEY,
  keyword text NOT NULL,
  mid text NOT NULL,
  product_name text,
  success_count int DEFAULT 0,
  fail_count int DEFAULT 0,
  last_reset_date date,
  worker_lock text,
  locked_at timestamp,
  created_at timestamp DEFAULT NOW(),
  updated_at timestamp DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_naverapp_mid
ON slot_naverapp(mid);

CREATE INDEX IF NOT EXISTS idx_slot_naverapp_keyword
ON slot_naverapp(keyword);

CREATE INDEX IF NOT EXISTS idx_slot_naverapp_worker_lock
ON slot_naverapp(worker_lock);

COMMENT ON TABLE slot_naverapp IS '운영 슬롯 통계 - 성공/실패 카운트';

-- 테스트 통계
CREATE TABLE IF NOT EXISTS slot_navertest (
  id bigserial PRIMARY KEY,
  keyword text NOT NULL,
  mid text NOT NULL,
  product_name text,
  success_count int DEFAULT 0,
  fail_count int DEFAULT 0,
  last_reset_date date,
  worker_lock text,
  locked_at timestamp,
  created_at timestamp DEFAULT NOW(),
  updated_at timestamp DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_navertest_mid
ON slot_navertest(mid);

CREATE INDEX IF NOT EXISTS idx_slot_navertest_keyword
ON slot_navertest(keyword);

CREATE INDEX IF NOT EXISTS idx_slot_navertest_worker_lock
ON slot_navertest(worker_lock);

COMMENT ON TABLE slot_navertest IS '테스트 슬롯 통계 - 성공/실패 카운트';

-- ============ 3. 히스토리 테이블 (실행 기록) ============

-- 운영 히스토리
CREATE TABLE IF NOT EXISTS slot_rank_naverapp_history (
  id bigserial PRIMARY KEY,
  slot_status_id bigint,
  keyword text,
  link_url text,
  mid text,
  product_name text,

  -- 순위 정보 (현재는 null, 향후 순위 체크 기능 추가 시 사용)
  current_rank int,
  start_rank int,
  rank_change int,
  previous_rank int,
  rank_diff int,

  -- 실행 결과
  success boolean NOT NULL,
  captcha_solved boolean DEFAULT false,
  fail_reason text,
  execution_duration_ms int,

  -- 메타데이터
  worker_id text,
  equipment_name text,
  ip_address text,
  rank_date timestamp NOT NULL,
  created_at timestamp DEFAULT NOW(),

  -- 분류
  customer_id text,
  distributor text,
  slot_type text,
  source_table text,
  source_row_id bigint
);

CREATE INDEX IF NOT EXISTS idx_naverapp_history_slot_id
ON slot_rank_naverapp_history(slot_status_id);

CREATE INDEX IF NOT EXISTS idx_naverapp_history_created_at
ON slot_rank_naverapp_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_naverapp_history_success
ON slot_rank_naverapp_history(success);

CREATE INDEX IF NOT EXISTS idx_naverapp_history_mid
ON slot_rank_naverapp_history(mid);

CREATE INDEX IF NOT EXISTS idx_naverapp_history_equipment
ON slot_rank_naverapp_history(equipment_name, created_at DESC);

COMMENT ON TABLE slot_rank_naverapp_history IS '운영 실행 히스토리 - 모든 실행 기록 (성공/실패)';

-- 테스트 히스토리
CREATE TABLE IF NOT EXISTS slot_rank_navertest_history (
  id bigserial PRIMARY KEY,
  slot_status_id bigint,
  keyword text,
  link_url text,
  mid text,
  product_name text,

  -- 순위 정보
  current_rank int,
  start_rank int,
  rank_change int,
  previous_rank int,
  rank_diff int,

  -- 실행 결과
  success boolean NOT NULL,
  captcha_solved boolean DEFAULT false,
  fail_reason text,
  execution_duration_ms int,

  -- 메타데이터
  worker_id text,
  equipment_name text,
  ip_address text,
  rank_date timestamp NOT NULL,
  created_at timestamp DEFAULT NOW(),

  -- 분류
  customer_id text,
  distributor text,
  slot_type text,
  source_table text,
  source_row_id bigint
);

CREATE INDEX IF NOT EXISTS idx_navertest_history_slot_id
ON slot_rank_navertest_history(slot_status_id);

CREATE INDEX IF NOT EXISTS idx_navertest_history_created_at
ON slot_rank_navertest_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_navertest_history_success
ON slot_rank_navertest_history(success);

CREATE INDEX IF NOT EXISTS idx_navertest_history_mid
ON slot_rank_navertest_history(mid);

CREATE INDEX IF NOT EXISTS idx_navertest_history_equipment
ON slot_rank_navertest_history(equipment_name, created_at DESC);

COMMENT ON TABLE slot_rank_navertest_history IS '테스트 실행 히스토리 - 모든 실행 기록 (성공/실패)';

-- ============ 4. 샘플 데이터 (테스트용) ============

-- slot_navertest 샘플 (테스트 러너 검증용)
-- 주의: mid는 실제 상품 ID로 변경해야 함
INSERT INTO slot_navertest (keyword, mid, product_name) VALUES
('테스트상품1', '90379584423', '테스트상품1'),
('테스트상품2', '9211038096', '테스트상품2'),
('테스트상품3', '12345678901', '테스트상품3'),
('테스트상품4', '12345678902', '테스트상품4'),
('테스트상품5', '12345678903', '테스트상품5')
ON CONFLICT DO NOTHING;

-- traffic_navershopping-test 샘플 (테스트 큐용)
INSERT INTO "traffic_navershopping-test" (slot_id, keyword, link_url, slot_type)
SELECT
  id,
  keyword,
  'https://smartstore.naver.com/_/products/' || mid,
  '네이버쇼핑'
FROM slot_navertest
LIMIT 5
ON CONFLICT DO NOTHING;

-- ============ 5. 유용한 쿼리 모음 ============

-- 히스토리 통계 확인 (최근 1시간)
-- SELECT
--   COUNT(*) as total,
--   SUM(CASE WHEN success THEN 1 ELSE 0 END) as success_count,
--   SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) as fail_count,
--   SUM(CASE WHEN captcha_solved THEN 1 ELSE 0 END) as captcha_count,
--   AVG(execution_duration_ms) as avg_duration_ms,
--   MIN(execution_duration_ms) as min_duration_ms,
--   MAX(execution_duration_ms) as max_duration_ms
-- FROM slot_rank_naverapp_history
-- WHERE created_at > NOW() - INTERVAL '1 hour';

-- 시간대별 성공률 분석
-- SELECT
--   DATE_TRUNC('hour', created_at) as hour,
--   COUNT(*) as total,
--   SUM(CASE WHEN success THEN 1 ELSE 0 END) as success,
--   ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
-- FROM slot_rank_naverapp_history
-- WHERE created_at > NOW() - INTERVAL '24 hours'
-- GROUP BY hour
-- ORDER BY hour DESC;

-- 워커별 성능 비교
-- SELECT
--   worker_id,
--   COUNT(*) as tasks,
--   SUM(CASE WHEN success THEN 1 ELSE 0 END) as success,
--   AVG(execution_duration_ms) as avg_duration
-- FROM slot_rank_naverapp_history
-- WHERE created_at > NOW() - INTERVAL '1 hour'
-- GROUP BY worker_id;

-- 실패 원인 분석
-- SELECT
--   fail_reason,
--   COUNT(*) as count,
--   ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 2) as percentage
-- FROM slot_rank_naverapp_history
-- WHERE success = false AND created_at > NOW() - INTERVAL '24 hours'
-- GROUP BY fail_reason
-- ORDER BY count DESC;

-- 30일 이전 데이터 정리 (주기적으로 실행)
-- DELETE FROM slot_rank_naverapp_history
-- WHERE created_at < NOW() - INTERVAL '30 days';

-- DELETE FROM slot_rank_navertest_history
-- WHERE created_at < NOW() - INTERVAL '30 days';

-- ============================================================
-- 완료
-- ============================================================
