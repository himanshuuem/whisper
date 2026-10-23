CREATE TABLE IF NOT EXISTS users (
  id             SERIAL       PRIMARY KEY,
  email          VARCHAR(254) NOT NULL,
  password_hash  VARCHAR(100),                      -- NULL for Google-only accounts
  google_id      VARCHAR(64)  UNIQUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS whispers (
  id          SERIAL       PRIMARY KEY,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        VARCHAR(500) NOT NULL CHECK (char_length(trim(body)) >= 3),
  mood        VARCHAR(12)  NOT NULL DEFAULT 'confession' CHECK (mood IN ('confession', 'hope', 'regret', 'win', 'fear')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whispers_created_idx ON whispers (created_at DESC);

CREATE TABLE IF NOT EXISTS hearts (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  whisper_id  INTEGER NOT NULL REFERENCES whispers(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, whisper_id)
);

-- Session store used by connect-pg-simple.
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR      NOT NULL PRIMARY KEY,
  "sess"   JSON         NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
