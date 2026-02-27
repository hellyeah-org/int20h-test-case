CREATE TABLE "identifier_systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"key" varchar(120) NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_identifier_systems_key_not_blank" CHECK (btrim("key") <> ''),
	CONSTRAINT "chk_identifier_systems_name_not_blank" CHECK (btrim("name") <> '')
);
--> statement-breakpoint
CREATE TABLE "jurisdiction_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"jurisdiction_id" uuid NOT NULL,
	"system_id" uuid NOT NULL,
	"scope" varchar(64),
	"value_raw" varchar(120) NOT NULL,
	"value_norm" varchar(120) NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_jurisdiction_identifiers_value_raw_not_blank" CHECK (btrim("value_raw") <> ''),
	CONSTRAINT "chk_jurisdiction_identifiers_value_norm_not_blank" CHECK (btrim("value_norm") <> ''),
	CONSTRAINT "chk_jurisdiction_identifiers_scope_not_blank" CHECK ("scope" IS NULL OR btrim("scope") <> ''),
	CONSTRAINT "chk_jurisdiction_identifiers_valid_to_gt_from" CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" > "valid_from")
);
--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP CONSTRAINT "chk_jurisdictions_fips_numeric_or_null";--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP CONSTRAINT "chk_jurisdictions_fips_length_by_type";--> statement-breakpoint
DROP INDEX "uq_jurisdictions_fips_code";--> statement-breakpoint
DROP INDEX "uq_jurisdictions_nys_reporting_code";--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP COLUMN "fips_code";--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP COLUMN "nys_reporting_code";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_identifier_systems_key" ON "identifier_systems" ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_jurisdiction_identifiers_exact" ON "jurisdiction_identifiers" ("system_id","scope","value_norm","jurisdiction_id","valid_from","valid_to");--> statement-breakpoint
CREATE INDEX "idx_jurisdiction_identifiers_lookup" ON "jurisdiction_identifiers" ("system_id","scope","value_norm");--> statement-breakpoint
CREATE INDEX "idx_jurisdiction_identifiers_lookup_asof" ON "jurisdiction_identifiers" ("system_id","scope","value_norm","valid_from","valid_to");--> statement-breakpoint
CREATE INDEX "idx_jurisdiction_identifiers_reverse" ON "jurisdiction_identifiers" ("jurisdiction_id","system_id");--> statement-breakpoint
CREATE INDEX "idx_tax_rates_jurisdiction_from_to" ON "tax_rates" ("jurisdiction_id","effective_from","effective_to");--> statement-breakpoint
ALTER TABLE "jurisdiction_identifiers" ADD CONSTRAINT "jurisdiction_identifiers_jurisdiction_id_jurisdictions_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "jurisdiction_identifiers" ADD CONSTRAINT "jurisdiction_identifiers_system_id_identifier_systems_id_fkey" FOREIGN KEY ("system_id") REFERENCES "identifier_systems"("id") ON DELETE RESTRICT;