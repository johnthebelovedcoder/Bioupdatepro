ALTER TABLE users
  ADD COLUMN mfa_secret TEXT,
  ADD COLUMN mfa_enabled_at TIMESTAMP(3),
  ADD COLUMN mfa_pending_secret TEXT,
  ADD COLUMN mfa_last_used_step BIGINT;

CREATE TABLE mfa_recovery_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT mfa_recovery_codes_pkey PRIMARY KEY (id),
  CONSTRAINT mfa_recovery_codes_code_hash_key UNIQUE (code_hash),
  CONSTRAINT mfa_recovery_codes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX mfa_recovery_codes_user_id_used_at_idx
  ON mfa_recovery_codes(user_id, used_at);

CREATE TABLE mfa_login_challenges (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  used_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT mfa_login_challenges_pkey PRIMARY KEY (id),
  CONSTRAINT mfa_login_challenges_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX mfa_login_challenges_user_id_expires_at_idx
  ON mfa_login_challenges(user_id, expires_at);
CREATE INDEX mfa_login_challenges_expires_at_used_at_idx
  ON mfa_login_challenges(expires_at, used_at);
