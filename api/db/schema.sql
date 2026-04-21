CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NULL,
  role ENUM('admin', 'client') NOT NULL DEFAULT 'client',
  has_access BOOLEAN NOT NULL DEFAULT FALSE,
  created_by VARCHAR(255) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
);

UPDATE users SET role = 'client' WHERE role = 'user';
ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'client') NOT NULL DEFAULT 'client';

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT NOT NULL AUTO_INCREMENT,
  actor_email VARCHAR(255) NOT NULL,
  action VARCHAR(128) NOT NULL,
  target_email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key_name VARCHAR(128) NOT NULL,
  value_text TEXT NOT NULL,
  updated_by VARCHAR(255) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (key_name)
);

CREATE TABLE IF NOT EXISTS instruments (
  instrument_token BIGINT NOT NULL,
  tradingsymbol VARCHAR(64) NOT NULL,
  exchange VARCHAR(16) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (instrument_token),
  KEY idx_instruments_symbol_exchange (tradingsymbol, exchange)
);

CREATE TABLE IF NOT EXISTS candles_1m (
  instrument_token BIGINT NOT NULL,
  ts_minute BIGINT NOT NULL,
  open DOUBLE NOT NULL,
  high DOUBLE NOT NULL,
  low DOUBLE NOT NULL,
  close DOUBLE NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (instrument_token, ts_minute),
  KEY idx_candles_1m_ts (ts_minute)
);

CREATE TABLE IF NOT EXISTS movers_1m (
  ts_minute BIGINT NOT NULL,
  symbol VARCHAR(64) NOT NULL,
  per_change DOUBLE NOT NULL,
  per_to_index DOUBLE NULL,
  point_to_index DOUBLE NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ts_minute, symbol),
  KEY idx_movers_1m_symbol (symbol)
);

CREATE TABLE IF NOT EXISTS index_movers_1m (
  index_key VARCHAR(32) NOT NULL,
  ts_minute BIGINT NOT NULL,
  rank_no INT NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  per_change DOUBLE NOT NULL,
  per_to_index DOUBLE NULL,
  point_to_index DOUBLE NULL,
  abs_point_to_index DOUBLE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (index_key, ts_minute, symbol),
  KEY idx_index_ts_rank (index_key, ts_minute, rank_no),
  KEY idx_index_movers_ts (ts_minute)
);

CREATE TABLE IF NOT EXISTS index_candles_1m (
  index_key VARCHAR(32) NOT NULL,
  ts_minute BIGINT NOT NULL,
  open DOUBLE NOT NULL,
  high DOUBLE NOT NULL,
  low DOUBLE NOT NULL,
  close DOUBLE NOT NULL,
  volume BIGINT NOT NULL DEFAULT 0,
  source VARCHAR(64) NOT NULL DEFAULT 'zerodha',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (index_key, ts_minute),
  KEY idx_index_candles_ts (ts_minute)
);

CREATE TABLE IF NOT EXISTS option_chain_1m (
  symbol VARCHAR(32) NOT NULL,
  ts_minute BIGINT NOT NULL,
  contract_key VARCHAR(96) NOT NULL,
  expiry VARCHAR(32) NOT NULL,
  strike DOUBLE NOT NULL,
  option_type VARCHAR(2) NOT NULL,
  oi BIGINT NOT NULL DEFAULT 0,
  volume BIGINT NOT NULL DEFAULT 0,
  iv DOUBLE NOT NULL DEFAULT 0,
  ltp DOUBLE NOT NULL DEFAULT 0,
  underlying DOUBLE NOT NULL DEFAULT 0,
  source VARCHAR(64) NOT NULL DEFAULT 'zerodha',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (symbol, ts_minute, contract_key),
  KEY idx_option_chain_ts_symbol (ts_minute, symbol)
);

CREATE TABLE IF NOT EXISTS community_posts (
  id BIGINT NOT NULL AUTO_INCREMENT,
  author_email VARCHAR(255) NOT NULL,
  category ENUM('PnL', 'Trading Setup', 'Trading Goals', 'Memes', 'Chart Analysis') NOT NULL,
  title VARCHAR(75) NOT NULL,
  description_text TEXT NOT NULL,
  primary_image LONGTEXT NOT NULL,
  secondary_image LONGTEXT NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  likes_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_community_posts_created_at (created_at, id),
  KEY idx_community_posts_author (author_email, created_at, id),
  KEY idx_community_posts_category (category, status, created_at, id),
  KEY idx_community_posts_status (status, created_at, id)
);

SET @community_status_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'community_posts'
    AND column_name = 'status'
);

SET @community_status_alter_sql := IF(
  @community_status_column_exists = 0,
  "ALTER TABLE community_posts ADD COLUMN status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending' AFTER secondary_image",
  'SELECT 1'
);

PREPARE community_status_stmt FROM @community_status_alter_sql;
EXECUTE community_status_stmt;
DEALLOCATE PREPARE community_status_stmt;

CREATE TABLE IF NOT EXISTS community_post_likes (
  post_id BIGINT NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_email),
  KEY idx_community_post_likes_user (user_email, created_at),
  CONSTRAINT fk_community_post_likes_post
    FOREIGN KEY (post_id)
    REFERENCES community_posts (id)
    ON DELETE CASCADE
);
