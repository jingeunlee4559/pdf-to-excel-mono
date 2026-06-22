-- =========================================================
-- Chat session / follow-up / download list migration patch
-- 목적: 후속 질문, 채팅 저장, 채팅 목록, 다운로드 목록 연동
-- MySQL 8.x 기준
-- =========================================================

USE prototypeversion3;

CREATE TABLE IF NOT EXISTS document_chat_sessions (
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

CREATE TABLE IF NOT EXISTS document_chat_messages (
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

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'generated_excels'
    AND COLUMN_NAME = 'source_session_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE generated_excels ADD COLUMN source_session_id BIGINT NULL AFTER template_id',
  'SELECT ''generated_excels.source_session_id already exists'' AS message'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'generated_excels'
    AND COLUMN_NAME = 'source_message_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE generated_excels ADD COLUMN source_message_id BIGINT NULL AFTER source_session_id',
  'SELECT ''generated_excels.source_message_id already exists'' AS message'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'generated_excels'
    AND INDEX_NAME = 'idx_generated_excels_source_session_id'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE generated_excels ADD INDEX idx_generated_excels_source_session_id (source_session_id)',
  'SELECT ''idx_generated_excels_source_session_id already exists'' AS message'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
