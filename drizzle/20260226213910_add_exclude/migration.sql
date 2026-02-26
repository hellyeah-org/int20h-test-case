DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'excl_tax_rates_jurisdiction_effective_no_overlap'
  ) THEN
    ALTER TABLE "tax_rates"
      ADD CONSTRAINT "excl_tax_rates_jurisdiction_effective_no_overlap"
      EXCLUDE USING gist (
        "jurisdiction_id" WITH =,
        daterange(
          "effective_from",
          COALESCE("effective_to", 'infinity'::date),
          '[)'
        ) WITH &&
      );
  END IF;
END
$$;