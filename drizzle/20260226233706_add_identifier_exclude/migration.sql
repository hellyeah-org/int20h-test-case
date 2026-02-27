DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ex_jurisdiction_identifiers_no_overlap'
  ) THEN
    ALTER TABLE "jurisdiction_identifiers"
      ADD CONSTRAINT "ex_jurisdiction_identifiers_no_overlap"
      EXCLUDE USING gist (
        "system_id" WITH =,
        COALESCE("scope", '') WITH =,
        "value_norm" WITH =,
        daterange(
          COALESCE("valid_from", '-infinity'::date),
          COALESCE("valid_to",   'infinity'::date),
          '[)'
        ) WITH &&
      );
  END IF;
END
$$;