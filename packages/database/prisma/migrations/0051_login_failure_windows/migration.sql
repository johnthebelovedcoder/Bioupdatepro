-- Failed sign-in attempts must be shared across API restarts and instances.
-- Store only a SHA-256 digest of the normalized address, never the address.
CREATE TABLE "login_failure_windows" (
    "email_hash" TEXT NOT NULL,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_failure_windows_pkey" PRIMARY KEY ("email_hash"),
    CONSTRAINT "login_failure_windows_count_chk" CHECK ("failure_count" BETWEEN 1 AND 10),
    CONSTRAINT "login_failure_windows_hash_chk" CHECK (length("email_hash") = 64)
);

CREATE INDEX "login_failure_windows_window_started_at_idx"
    ON "login_failure_windows"("window_started_at");
