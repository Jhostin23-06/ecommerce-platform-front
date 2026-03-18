ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "emailVerifiedAt" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "emailVerificationTokenHash" varchar NULL,
  ADD COLUMN IF NOT EXISTS "emailVerificationExpiresAt" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "passwordResetTokenHash" varchar NULL,
  ADD COLUMN IF NOT EXISTS "passwordResetExpiresAt" timestamptz NULL;

CREATE INDEX IF NOT EXISTS ix_users_email_verification_token
  ON users ("emailVerificationTokenHash");

CREATE INDEX IF NOT EXISTS ix_users_password_reset_token
  ON users ("passwordResetTokenHash");

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_transactions_provider_external
  ON payment_transactions (provider, "externalId");
