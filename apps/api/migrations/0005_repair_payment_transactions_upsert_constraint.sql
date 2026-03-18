WITH duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY provider, "externalId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
    ) AS rn
  FROM payment_transactions
  WHERE "externalId" IS NOT NULL
)
DELETE FROM payment_transactions
WHERE id IN (
  SELECT id
  FROM duplicates
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_transactions_provider_external
  ON payment_transactions (provider, "externalId");
