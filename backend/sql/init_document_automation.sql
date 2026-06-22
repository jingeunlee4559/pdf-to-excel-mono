-- =========================================================
-- AI 업무문서 자동화 시스템 전체 초기화 DB Schema + Seed
-- 테스트 계정:
--   시스템관리자: admin / 1234
--   일반사용자: user / 1234
-- MySQL 8.x 기준
-- =========================================================

CREATE DATABASE IF NOT EXISTS prototypeversion3
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE prototypeversion3;


SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS document_chat_messages;
DROP TABLE IF EXISTS document_chat_sessions;
DROP TABLE IF EXISTS generated_excels;
DROP TABLE IF EXISTS review_issues;
DROP TABLE IF EXISTS extracted_tables;
DROP TABLE IF EXISTS document_analysis_results;
DROP TABLE IF EXISTS source_files;
DROP TABLE IF EXISTS document_jobs;
DROP TABLE IF EXISTS excel_template_mappings;
DROP TABLE IF EXISTS excel_templates;
DROP TABLE IF EXISTS field_alias_keywords;
DROP TABLE IF EXISTS standard_fields;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;

SET FOREIGN_KEY_CHECKS = 1;

-- =========================================================
-- 1. 권한 역할
-- =========================================================

CREATE TABLE roles (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  role_code VARCHAR(50) NOT NULL UNIQUE,
  role_name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  active_yn CHAR(1) NOT NULL DEFAULT 'Y',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_roles_code (role_code),
  INDEX idx_roles_active (active_yn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 2. 사용자
-- =========================================================

CREATE TABLE users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  role_id BIGINT NOT NULL,
  login_id VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  user_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(50) NULL,
  department_name VARCHAR(100) NULL,
  position_name VARCHAR(100) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role
    FOREIGN KEY (role_id) REFERENCES roles(id)
    ON DELETE RESTRICT,
  INDEX idx_users_role_id (role_id),
  INDEX idx_users_login_id (login_id),
  INDEX idx_users_status (status),
  INDEX idx_users_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 3. 표준 필드 사전
-- =========================================================

CREATE TABLE standard_fields (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  field_key VARCHAR(100) NOT NULL UNIQUE,
  field_label VARCHAR(100) NOT NULL,
  field_group VARCHAR(50) NOT NULL,
  data_type VARCHAR(30) NOT NULL DEFAULT 'text',
  description TEXT NULL,
  active_yn CHAR(1) NOT NULL DEFAULT 'Y',
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_standard_fields_group (field_group),
  INDEX idx_standard_fields_active (active_yn),
  INDEX idx_standard_fields_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 4. 필드 별칭 / 매핑 키워드
-- =========================================================

CREATE TABLE field_alias_keywords (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  field_key VARCHAR(100) NOT NULL,
  alias_keyword VARCHAR(100) NOT NULL,
  match_type VARCHAR(30) NOT NULL DEFAULT 'CONTAINS',
  priority INT NOT NULL DEFAULT 100,
  active_yn CHAR(1) NOT NULL DEFAULT 'Y',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_alias_keywords_field
    FOREIGN KEY (field_key) REFERENCES standard_fields(field_key)
    ON DELETE CASCADE,
  INDEX idx_alias_keywords_field_key (field_key),
  INDEX idx_alias_keywords_alias (alias_keyword),
  INDEX idx_alias_keywords_active (active_yn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 5. 자사 엑셀 템플릿
-- =========================================================

CREATE TABLE excel_templates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_by BIGINT NULL,
  template_name VARCHAR(255) NOT NULL,
  template_code VARCHAR(100) NOT NULL UNIQUE,
  template_type VARCHAR(100) NOT NULL DEFAULT 'NORMAL_TABLE',
  file_path VARCHAR(500) NOT NULL,
  original_file_name VARCHAR(255) NULL,
  default_sheet_name VARCHAR(100) NULL,
  description TEXT NULL,
  active_yn CHAR(1) NOT NULL DEFAULT 'Y',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_excel_templates_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_excel_templates_created_by (created_by),
  INDEX idx_excel_templates_type (template_type),
  INDEX idx_excel_templates_active (active_yn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 6. 자사 엑셀 템플릿 매핑
-- =========================================================

CREATE TABLE excel_template_mappings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  template_id BIGINT NOT NULL,
  created_by BIGINT NULL,
  mapping_name VARCHAR(255) NULL,
  mapping_version VARCHAR(50) NOT NULL DEFAULT 'v1',
  mapping_json JSON NOT NULL,
  active_yn CHAR(1) NOT NULL DEFAULT 'Y',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_template_mappings_template
    FOREIGN KEY (template_id) REFERENCES excel_templates(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_template_mappings_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_template_mappings_template_id (template_id),
  INDEX idx_template_mappings_created_by (created_by),
  INDEX idx_template_mappings_active (active_yn),
  INDEX idx_template_mappings_version (mapping_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 7. 문서 작업 단위
-- =========================================================

CREATE TABLE document_jobs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  title VARCHAR(255) NULL,
  user_request TEXT NULL,
  output_mode VARCHAR(30) NOT NULL DEFAULT 'FREE_FORM',
  template_id BIGINT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'UPLOADED',
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_document_jobs_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_document_jobs_template
    FOREIGN KEY (template_id) REFERENCES excel_templates(id)
    ON DELETE SET NULL,
  INDEX idx_document_jobs_user_id (user_id),
  INDEX idx_document_jobs_template_id (template_id),
  INDEX idx_document_jobs_status (status),
  INDEX idx_document_jobs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 7-1. 문서 작업 채팅 세션
-- =========================================================

CREATE TABLE document_chat_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  active_job_id BIGINT NULL,
  title VARCHAR(255) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_chat_sessions_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_chat_sessions_active_job
    FOREIGN KEY (active_job_id) REFERENCES document_jobs(id)
    ON DELETE SET NULL,
  INDEX idx_chat_sessions_user_id (user_id),
  INDEX idx_chat_sessions_active_job_id (active_job_id),
  INDEX idx_chat_sessions_updated_at (updated_at),
  INDEX idx_chat_sessions_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 7-2. 문서 작업 채팅 메시지
-- =========================================================

CREATE TABLE document_chat_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT NOT NULL,
  job_id BIGINT NULL,
  role VARCHAR(30) NOT NULL,
  message_text LONGTEXT NOT NULL,
  payload_json JSON NULL,
  action VARCHAR(100) NULL,
  llm_model VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_chat_messages_session
    FOREIGN KEY (session_id) REFERENCES document_chat_sessions(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_chat_messages_job
    FOREIGN KEY (job_id) REFERENCES document_jobs(id)
    ON DELETE SET NULL,
  INDEX idx_chat_messages_session_id (session_id),
  INDEX idx_chat_messages_job_id (job_id),
  INDEX idx_chat_messages_created_at (created_at),
  INDEX idx_chat_messages_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 8. 업로드 파일
-- =========================================================

CREATE TABLE source_files (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id BIGINT NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_type VARCHAR(50) NULL,
  mime_type VARCHAR(100) NULL,
  file_size BIGINT NULL,
  page_count INT NULL,
  parse_status VARCHAR(50) NOT NULL DEFAULT 'WAITING',
  extracted_text LONGTEXT NULL,
  extracted_pages_json JSON NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_source_files_job
    FOREIGN KEY (job_id) REFERENCES document_jobs(id)
    ON DELETE CASCADE,
  INDEX idx_source_files_job_id (job_id),
  INDEX idx_source_files_parse_status (parse_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 9. 문서 분석 결과
-- =========================================================

CREATE TABLE document_analysis_results (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id BIGINT NOT NULL,
  document_type VARCHAR(100) NULL,
  recommended_table_type VARCHAR(100) NULL,
  document_purpose TEXT NULL,
  summary TEXT NULL,
  confidence DECIMAL(5,4) NULL,
  needs_review_yn CHAR(1) NOT NULL DEFAULT 'N',
  review_summary TEXT NULL,
  analysis_json JSON NULL,
  llm_model VARCHAR(100) NULL,
  prompt_version VARCHAR(50) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_analysis_results_job
    FOREIGN KEY (job_id) REFERENCES document_jobs(id)
    ON DELETE CASCADE,
  INDEX idx_analysis_results_job_id (job_id),
  INDEX idx_analysis_results_document_type (document_type),
  INDEX idx_analysis_results_table_type (recommended_table_type),
  INDEX idx_analysis_results_needs_review (needs_review_yn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 10. 추출된 표 데이터
-- =========================================================

CREATE TABLE extracted_tables (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id BIGINT NOT NULL,
  table_name VARCHAR(255) NULL,
  table_type VARCHAR(100) NOT NULL DEFAULT 'NORMAL_TABLE',
  columns_json JSON NULL,
  rows_json JSON NULL,
  table_json JSON NULL,
  row_count INT NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_extracted_tables_job
    FOREIGN KEY (job_id) REFERENCES document_jobs(id)
    ON DELETE CASCADE,
  INDEX idx_extracted_tables_job_id (job_id),
  INDEX idx_extracted_tables_table_type (table_type),
  INDEX idx_extracted_tables_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 11. 확인 필요 항목
-- =========================================================

CREATE TABLE review_issues (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id BIGINT NOT NULL,
  table_id BIGINT NULL,
  row_index INT NULL,
  target_key VARCHAR(100) NULL,
  target_name VARCHAR(255) NULL,
  field_key VARCHAR(100) NULL,
  field_label VARCHAR(100) NULL,
  issue_type VARCHAR(100) NOT NULL,
  severity VARCHAR(30) NOT NULL DEFAULT 'WARNING',
  message TEXT NOT NULL,
  suggested_value VARCHAR(255) NULL,
  resolved_yn CHAR(1) NOT NULL DEFAULT 'N',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  CONSTRAINT fk_review_issues_job
    FOREIGN KEY (job_id) REFERENCES document_jobs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_review_issues_table
    FOREIGN KEY (table_id) REFERENCES extracted_tables(id)
    ON DELETE SET NULL,
  INDEX idx_review_issues_job_id (job_id),
  INDEX idx_review_issues_table_id (table_id),
  INDEX idx_review_issues_resolved (resolved_yn),
  INDEX idx_review_issues_severity (severity),
  INDEX idx_review_issues_field_key (field_key),
  INDEX idx_review_issues_target_key (target_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 12. 생성된 엑셀 파일
-- =========================================================

CREATE TABLE generated_excels (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id BIGINT NOT NULL,
  template_id BIGINT NULL,
  source_session_id BIGINT NULL,
  source_message_id BIGINT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  generated_status VARCHAR(50) NOT NULL DEFAULT 'GENERATED',
  downloaded_yn CHAR(1) NOT NULL DEFAULT 'N',
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  downloaded_at DATETIME NULL,
  CONSTRAINT fk_generated_excels_job
    FOREIGN KEY (job_id) REFERENCES document_jobs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_generated_excels_template
    FOREIGN KEY (template_id) REFERENCES excel_templates(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_generated_excels_session
    FOREIGN KEY (source_session_id) REFERENCES document_chat_sessions(id)
    ON DELETE SET NULL,
  INDEX idx_generated_excels_job_id (job_id),
  INDEX idx_generated_excels_template_id (template_id),
  INDEX idx_generated_excels_source_session_id (source_session_id),
  INDEX idx_generated_excels_status (generated_status),
  INDEX idx_generated_excels_downloaded (downloaded_yn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- Seed 1. 권한
-- =========================================================

INSERT INTO roles (role_code, role_name, description, active_yn)
VALUES
('SYSTEM_ADMIN', '시스템 관리자', '사용자 관리, 자사 양식 등록, 템플릿 매핑 관리 권한', 'Y'),
('GENERAL_USER', '일반 사용자', '문서 업로드, 문서 분석, 표 생성, 엑셀 다운로드 권한', 'Y');

SET @system_admin_role_id := (SELECT id FROM roles WHERE role_code = 'SYSTEM_ADMIN');
SET @general_user_role_id := (SELECT id FROM roles WHERE role_code = 'GENERAL_USER');

-- =========================================================
-- Seed 2. 테스트 계정
-- 시스템관리자: admin / 1234
-- 일반사용자: user / 1234
-- =========================================================

INSERT INTO users (
  role_id,
  login_id,
  password_hash,
  user_name,
  email,
  department_name,
  position_name,
  status
) VALUES
(
  @system_admin_role_id,
  'admin',
  '$2b$12$qtNUaPEO9yhWOmLn3bLMy.GnxpkGZkSSDhnldpUFGRoxucPtGRDT2',
  '시스템관리자',
  'admin@example.com',
  '시스템관리',
  '관리자',
  'ACTIVE'
),
(
  @general_user_role_id,
  'user',
  '$2b$12$gLZOTebB2.HsdZZfZm0RA.oCiFkAxWpHiD.mfYa3enlyhrWV68H/i',
  '일반사용자',
  'user@example.com',
  '공사팀',
  '사용자',
  'ACTIVE'
);

SET @admin_user_id := (SELECT id FROM users WHERE login_id = 'admin');

-- =========================================================
-- Seed 3. 표준 필드
-- =========================================================

INSERT INTO standard_fields
(field_key, field_label, field_group, data_type, description, sort_order)
VALUES
('document_title', '문서명', 'HEADER', 'text', '문서 제목 또는 산출물 제목', 10),
('document_date', '작성일', 'HEADER', 'date', '문서 작성일 또는 기준일', 20),
('document_no', '문서번호', 'HEADER', 'text', '문서 번호, 견적 번호, 거래 번호', 30),
('project_name', '공사명', 'HEADER', 'text', '공사명 또는 프로젝트명', 40),
('site_name', '현장명', 'HEADER', 'text', '현장명', 50),
('department_name', '부서명', 'HEADER', 'text', '부서명', 60),
('requester_name', '요청자', 'HEADER', 'text', '요청자 또는 작성자', 70),
('vendor_name', '업체명', 'HEADER', 'text', '거래처, 공급업체, 시공업체 등', 80),
('row_no', '순번', 'DETAIL', 'number', '행 번호', 100),
('item_name', '품목명', 'DETAIL', 'text', '품목, 자재, 장비, 작업 항목명', 110),
('spec', '규격', 'DETAIL', 'text', '규격, 사양, 모델, 크기', 120),
('unit', '단위', 'DETAIL', 'text', 'EA, 개, 식, m 등 단위', 130),
('quantity', '수량', 'DETAIL', 'number', '수량', 140),
('unit_price', '단가', 'DETAIL', 'amount', '단가', 150),
('supply_amount', '공급가액', 'DETAIL', 'amount', '공급가액', 160),
('tax_amount', '세액', 'DETAIL', 'amount', '부가세, 세액', 170),
('amount', '금액', 'DETAIL', 'amount', '금액, 합계금액', 180),
('delivery_date', '납기', 'DETAIL', 'date', '납기, 납품일, 예정일', 190),
('work_date', '작업일자', 'DETAIL', 'date', '작업일자', 200),
('work_content', '작업내용', 'DETAIL', 'text', '작업 내용', 210),
('worker_count', '투입인원', 'DETAIL', 'number', '작업 투입 인원', 220),
('equipment_name', '장비명', 'DETAIL', 'text', '장비명', 230),
('remark', '비고', 'DETAIL', 'text', '비고, 특이사항, 참고사항', 240),
('target_name', '비교대상명', 'TARGET', 'text', '업체명, 안, 현장, 부서 등 비교 대상명', 300),
('target_type', '비교대상유형', 'TARGET', 'text', '업체, 안, 현장, 부서 등 비교 대상 유형', 310),
('comparison_note', '비교메모', 'COMPARISON_FIELD', 'text', '비교 관련 메모', 320),
('total_amount', '총액', 'SUMMARY', 'amount', '총액, 합계', 400),
('lowest_target', '최저 대상', 'SUMMARY', 'text', '비교 결과 최저가 또는 최저값 대상', 410),
('highest_target', '최고 대상', 'SUMMARY', 'text', '비교 결과 최고가 또는 최고값 대상', 420),
('review_status', '확인상태', 'REVIEW', 'text', '정상, 확인 필요 등 상태', 500),
('review_message', '확인내용', 'REVIEW', 'text', '확인 필요 사유', 510);

-- =========================================================
-- Seed 4. 필드 별칭 / 매핑 키워드
-- =========================================================

INSERT INTO field_alias_keywords
(field_key, alias_keyword, match_type, priority)
VALUES
('document_title', '문서명', 'CONTAINS', 10),
('document_title', '제목', 'CONTAINS', 20),
('document_title', '자료명', 'CONTAINS', 30),
('document_title', '산출물명', 'CONTAINS', 40),
('document_date', '작성일', 'CONTAINS', 10),
('document_date', '일자', 'CONTAINS', 20),
('document_date', '날짜', 'CONTAINS', 30),
('document_date', '기준일', 'CONTAINS', 40),
('document_date', '거래일자', 'CONTAINS', 50),
('document_date', '견적일자', 'CONTAINS', 60),
('document_no', '문서번호', 'CONTAINS', 10),
('document_no', '견적번호', 'CONTAINS', 20),
('document_no', '거래번호', 'CONTAINS', 30),
('document_no', '번호', 'CONTAINS', 40),
('project_name', '공사명', 'CONTAINS', 10),
('project_name', '프로젝트명', 'CONTAINS', 20),
('project_name', '사업명', 'CONTAINS', 30),
('site_name', '현장명', 'CONTAINS', 10),
('site_name', '현장', 'CONTAINS', 20),
('site_name', '공사현장', 'CONTAINS', 30),
('vendor_name', '업체명', 'CONTAINS', 10),
('vendor_name', '업체', 'CONTAINS', 20),
('vendor_name', '거래처', 'CONTAINS', 30),
('vendor_name', '공급업체', 'CONTAINS', 40),
('vendor_name', '시공업체', 'CONTAINS', 50),
('vendor_name', '상호', 'CONTAINS', 60),
('vendor_name', '회사명', 'CONTAINS', 70),
('item_name', '품목명', 'CONTAINS', 10),
('item_name', '품목', 'CONTAINS', 20),
('item_name', '자재명', 'CONTAINS', 30),
('item_name', '자재', 'CONTAINS', 40),
('item_name', '장비명', 'CONTAINS', 50),
('item_name', '내역명', 'CONTAINS', 60),
('item_name', '공종명', 'CONTAINS', 70),
('item_name', '작업명', 'CONTAINS', 80),
('spec', '규격', 'CONTAINS', 10),
('spec', '사양', 'CONTAINS', 20),
('spec', '모델', 'CONTAINS', 30),
('spec', '크기', 'CONTAINS', 40),
('spec', '규격명', 'CONTAINS', 50),
('unit', '단위', 'CONTAINS', 10),
('unit', 'UOM', 'CONTAINS', 20),
('quantity', '수량', 'EXACT', 5),
('quantity', '수량', 'CONTAINS', 10),
('quantity', '물량', 'CONTAINS', 20),
('quantity', '개수', 'CONTAINS', 30),
('unit_price', '단가', 'EXACT', 5),
('unit_price', '단가', 'CONTAINS', 10),
('unit_price', '견적단가', 'CONTAINS', 20),
('unit_price', '단위금액', 'CONTAINS', 30),
('amount', '금액', 'EXACT', 5),
('amount', '금액', 'CONTAINS', 10),
('amount', '합계금액', 'CONTAINS', 20),
('amount', '총금액', 'CONTAINS', 30),
('amount', '계', 'EXACT', 40),
('amount', '소계', 'CONTAINS', 50),
('supply_amount', '공급가액', 'CONTAINS', 10),
('supply_amount', '공급액', 'CONTAINS', 20),
('supply_amount', '공급금액', 'CONTAINS', 30),
('tax_amount', '세액', 'CONTAINS', 10),
('tax_amount', '부가세', 'CONTAINS', 20),
('tax_amount', 'VAT', 'CONTAINS', 30),
('delivery_date', '납기', 'CONTAINS', 10),
('delivery_date', '납품일', 'CONTAINS', 20),
('delivery_date', '예정일', 'CONTAINS', 30),
('delivery_date', '납품예정일', 'CONTAINS', 40),
('work_date', '작업일자', 'CONTAINS', 10),
('work_date', '작업일', 'CONTAINS', 20),
('work_date', '근무일', 'CONTAINS', 30),
('work_content', '작업내용', 'CONTAINS', 10),
('work_content', '작업 사항', 'CONTAINS', 20),
('work_content', '공사내용', 'CONTAINS', 30),
('work_content', '업무내용', 'CONTAINS', 40),
('worker_count', '투입인원', 'CONTAINS', 10),
('worker_count', '인원', 'CONTAINS', 20),
('worker_count', '작업인원', 'CONTAINS', 30),
('worker_count', '노무자', 'CONTAINS', 40),
('equipment_name', '장비명', 'CONTAINS', 10),
('equipment_name', '장비', 'CONTAINS', 20),
('equipment_name', '투입장비', 'CONTAINS', 30),
('remark', '비고', 'CONTAINS', 10),
('remark', '특이사항', 'CONTAINS', 20),
('remark', '참고사항', 'CONTAINS', 30),
('remark', '메모', 'CONTAINS', 40),
('target_name', '비교대상', 'CONTAINS', 10),
('target_name', '대상명', 'CONTAINS', 20),
('target_name', '업체명', 'CONTAINS', 30),
('target_name', '회사명', 'CONTAINS', 40),
('target_name', '공급처', 'CONTAINS', 50),
('target_name', 'A안', 'CONTAINS', 60),
('target_name', 'B안', 'CONTAINS', 70),
('target_type', '비교유형', 'CONTAINS', 10),
('target_type', '대상유형', 'CONTAINS', 20),
('total_amount', '총액', 'CONTAINS', 10),
('total_amount', '합계', 'CONTAINS', 20),
('total_amount', '총금액', 'CONTAINS', 30),
('total_amount', '총 합계', 'CONTAINS', 40);

-- =========================================================
-- Seed 5. 템플릿 1: 일반내역표
-- =========================================================

INSERT INTO excel_templates (
  created_by, template_name, template_code, template_type,
  file_path, original_file_name, default_sheet_name, description, active_yn
) VALUES (
  @admin_user_id, '일반내역표 v1', 'NORMAL_TABLE_V1', 'NORMAL_TABLE',
  '/storage/templates/normal_table_v1.xlsx', 'normal_table_v1.xlsx', '일반내역표',
  '견적서, 거래명세서, 자재 내역서 등 일반 행 반복 표 양식', 'Y'
);

SET @normal_template_id := LAST_INSERT_ID();

INSERT INTO excel_template_mappings (
  template_id, created_by, mapping_name, mapping_version, mapping_json, active_yn
) VALUES (
  @normal_template_id,
  @admin_user_id,
  '일반내역표 기본 매핑',
  'v1',
  JSON_OBJECT(
    'template_type', 'NORMAL_TABLE',
    'sheet_name', '일반내역표',
    'llm_fields', JSON_OBJECT(
      'required_fields', JSON_ARRAY(
        JSON_OBJECT('key', 'item_name', 'label', '품목명', 'data_type', 'text'),
        JSON_OBJECT('key', 'quantity', 'label', '수량', 'data_type', 'number'),
        JSON_OBJECT('key', 'unit_price', 'label', '단가', 'data_type', 'amount'),
        JSON_OBJECT('key', 'amount', 'label', '금액', 'data_type', 'amount')
      ),
      'optional_fields', JSON_ARRAY(
        JSON_OBJECT('key', 'document_date', 'label', '작성일', 'data_type', 'date'),
        JSON_OBJECT('key', 'vendor_name', 'label', '업체명', 'data_type', 'text'),
        JSON_OBJECT('key', 'site_name', 'label', '현장명', 'data_type', 'text'),
        JSON_OBJECT('key', 'spec', 'label', '규격', 'data_type', 'text'),
        JSON_OBJECT('key', 'unit', 'label', '단위', 'data_type', 'text'),
        JSON_OBJECT('key', 'supply_amount', 'label', '공급가액', 'data_type', 'amount'),
        JSON_OBJECT('key', 'tax_amount', 'label', '세액', 'data_type', 'amount'),
        JSON_OBJECT('key', 'remark', 'label', '비고', 'data_type', 'text')
      )
    ),
    'header', JSON_OBJECT(
      'document_title', 'B1',
      'document_date', 'B2',
      'site_name', 'D2',
      'vendor_name', 'B3'
    ),
    'table', JSON_OBJECT(
      'start_row', 5,
      'columns', JSON_ARRAY(
        JSON_OBJECT('key', 'item_name', 'label', '품목명', 'column', 'A', 'data_type', 'text', 'required', true),
        JSON_OBJECT('key', 'spec', 'label', '규격', 'column', 'B', 'data_type', 'text', 'required', false),
        JSON_OBJECT('key', 'unit', 'label', '단위', 'column', 'C', 'data_type', 'text', 'required', false),
        JSON_OBJECT('key', 'quantity', 'label', '수량', 'column', 'D', 'data_type', 'number', 'required', true),
        JSON_OBJECT('key', 'unit_price', 'label', '단가', 'column', 'E', 'data_type', 'amount', 'required', true),
        JSON_OBJECT('key', 'supply_amount', 'label', '공급가액', 'column', 'F', 'data_type', 'amount', 'required', false),
        JSON_OBJECT('key', 'tax_amount', 'label', '세액', 'column', 'G', 'data_type', 'amount', 'required', false),
        JSON_OBJECT('key', 'amount', 'label', '금액', 'column', 'H', 'data_type', 'amount', 'required', true),
        JSON_OBJECT('key', 'remark', 'label', '비고', 'column', 'I', 'data_type', 'text', 'required', false)
      )
    ),
    'summary', JSON_OBJECT('total_amount', 'H100')
  ),
  'Y'
);

-- =========================================================
-- Seed 6. 템플릿 2: 비교형 동적 컬럼 표
-- =========================================================

INSERT INTO excel_templates (
  created_by, template_name, template_code, template_type,
  file_path, original_file_name, default_sheet_name, description, active_yn
) VALUES (
  @admin_user_id, '비교표 v1', 'COMPARISON_MATRIX_V1', 'COMPARISON_MATRIX',
  '/storage/templates/comparison_matrix_v1.xlsx', 'comparison_matrix_v1.xlsx', '비교표',
  '업체별 단가 비교, 견적 비교, 장비 비교 등 비교 대상 컬럼이 동적으로 늘어나는 양식', 'Y'
);

SET @comparison_template_id := LAST_INSERT_ID();

INSERT INTO excel_template_mappings (
  template_id, created_by, mapping_name, mapping_version, mapping_json, active_yn
) VALUES (
  @comparison_template_id,
  @admin_user_id,
  '비교표 기본 매핑',
  'v1',
  JSON_OBJECT(
    'template_type', 'COMPARISON_MATRIX',
    'sheet_name', '비교표',
    'llm_fields', JSON_OBJECT(
      'base_fields', JSON_ARRAY(
        JSON_OBJECT('key', 'item_name', 'label', '품목명', 'data_type', 'text', 'required', true),
        JSON_OBJECT('key', 'spec', 'label', '규격', 'data_type', 'text', 'required', false),
        JSON_OBJECT('key', 'unit', 'label', '단위', 'data_type', 'text', 'required', false),
        JSON_OBJECT('key', 'quantity', 'label', '수량', 'data_type', 'number', 'required', false)
      ),
      'target_fields', JSON_ARRAY(
        JSON_OBJECT('key', 'target_name', 'label', '비교대상명', 'data_type', 'text', 'required', true),
        JSON_OBJECT('key', 'target_type', 'label', '비교대상유형', 'data_type', 'text', 'required', false)
      ),
      'comparison_fields', JSON_ARRAY(
        JSON_OBJECT('key', 'unit_price', 'label', '단가', 'data_type', 'amount', 'required', false),
        JSON_OBJECT('key', 'amount', 'label', '금액', 'data_type', 'amount', 'required', false),
        JSON_OBJECT('key', 'delivery_date', 'label', '납기', 'data_type', 'date', 'required', false),
        JSON_OBJECT('key', 'remark', 'label', '비고', 'data_type', 'text', 'required', false)
      )
    ),
    'header', JSON_OBJECT(
      'document_title', 'B1',
      'document_date', 'B2',
      'site_name', 'D2',
      'project_name', 'F2'
    ),
    'base_columns', JSON_OBJECT(
      'item_name', JSON_OBJECT('label', '품목명', 'column', 'A', 'start_row', 5, 'data_type', 'text', 'required', true),
      'spec', JSON_OBJECT('label', '규격', 'column', 'B', 'start_row', 5, 'data_type', 'text', 'required', false),
      'unit', JSON_OBJECT('label', '단위', 'column', 'C', 'start_row', 5, 'data_type', 'text', 'required', false),
      'quantity', JSON_OBJECT('label', '수량', 'column', 'D', 'start_row', 5, 'data_type', 'number', 'required', false)
    ),
    'target_column_group', JSON_OBJECT(
      'start_column', 'E',
      'header_row', 3,
      'sub_header_row', 4,
      'start_row', 5,
      'group_span', 4,
      'target_label', '비교 대상',
      'fields', JSON_ARRAY(
        JSON_OBJECT('key', 'unit_price', 'label', '단가', 'offset', 0, 'data_type', 'amount', 'required', false),
        JSON_OBJECT('key', 'amount', 'label', '금액', 'offset', 1, 'data_type', 'amount', 'required', false),
        JSON_OBJECT('key', 'delivery_date', 'label', '납기', 'offset', 2, 'data_type', 'date', 'required', false),
        JSON_OBJECT('key', 'remark', 'label', '비고', 'offset', 3, 'data_type', 'text', 'required', false)
      )
    )
  ),
  'Y'
);

-- =========================================================
-- Seed 7. 템플릿 3: 작업일보표
-- =========================================================

INSERT INTO excel_templates (
  created_by, template_name, template_code, template_type,
  file_path, original_file_name, default_sheet_name, description, active_yn
) VALUES (
  @admin_user_id, '작업일보표 v1', 'WORK_LOG_TABLE_V1', 'WORK_LOG_TABLE',
  '/storage/templates/work_log_table_v1.xlsx', 'work_log_table_v1.xlsx', '작업일보',
  '현장 작업일보, 작업내용, 투입인원, 장비 사용 내역을 정리하는 양식', 'Y'
);

SET @worklog_template_id := LAST_INSERT_ID();

INSERT INTO excel_template_mappings (
  template_id, created_by, mapping_name, mapping_version, mapping_json, active_yn
) VALUES (
  @worklog_template_id,
  @admin_user_id,
  '작업일보표 기본 매핑',
  'v1',
  JSON_OBJECT(
    'template_type', 'WORK_LOG_TABLE',
    'sheet_name', '작업일보',
    'llm_fields', JSON_OBJECT(
      'required_fields', JSON_ARRAY(
        JSON_OBJECT('key', 'work_date', 'label', '작업일자', 'data_type', 'date'),
        JSON_OBJECT('key', 'work_content', 'label', '작업내용', 'data_type', 'text')
      ),
      'optional_fields', JSON_ARRAY(
        JSON_OBJECT('key', 'site_name', 'label', '현장명', 'data_type', 'text'),
        JSON_OBJECT('key', 'worker_count', 'label', '투입인원', 'data_type', 'number'),
        JSON_OBJECT('key', 'equipment_name', 'label', '장비명', 'data_type', 'text'),
        JSON_OBJECT('key', 'remark', 'label', '비고', 'data_type', 'text')
      )
    ),
    'header', JSON_OBJECT(
      'document_title', 'B1',
      'work_date', 'B2',
      'site_name', 'D2'
    ),
    'table', JSON_OBJECT(
      'start_row', 5,
      'columns', JSON_ARRAY(
        JSON_OBJECT('key', 'work_date', 'label', '작업일자', 'column', 'A', 'data_type', 'date', 'required', true),
        JSON_OBJECT('key', 'site_name', 'label', '현장명', 'column', 'B', 'data_type', 'text', 'required', false),
        JSON_OBJECT('key', 'work_content', 'label', '작업내용', 'column', 'C', 'data_type', 'text', 'required', true),
        JSON_OBJECT('key', 'worker_count', 'label', '투입인원', 'column', 'D', 'data_type', 'number', 'required', false),
        JSON_OBJECT('key', 'equipment_name', 'label', '장비명', 'column', 'E', 'data_type', 'text', 'required', false),
        JSON_OBJECT('key', 'remark', 'label', '비고', 'column', 'F', 'data_type', 'text', 'required', false)
      )
    )
  ),
  'Y'
);

-- =========================================================
-- 확인용 SELECT
-- =========================================================

SELECT
  u.login_id,
  u.user_name,
  r.role_code,
  r.role_name,
  u.status
FROM users u
JOIN roles r ON r.id = u.role_id
ORDER BY u.id;

SELECT
  template_name,
  template_code,
  template_type,
  active_yn
FROM excel_templates
ORDER BY id;

SELECT
  field_key,
  field_label,
  field_group,
  data_type
FROM standard_fields
ORDER BY sort_order;
