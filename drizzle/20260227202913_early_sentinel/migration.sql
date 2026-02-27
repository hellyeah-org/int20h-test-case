CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"latitude" numeric(9,6) NOT NULL,
	"longitude" numeric(9,6) NOT NULL,
	"order_date" date NOT NULL,
	"subtotal_amount" numeric(12,2) NOT NULL,
	"composite_tax_rate" numeric(10,6) NOT NULL,
	"tax_amount" numeric(12,2) NOT NULL,
	"total_amount" numeric(12,2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_orders_lat_range" CHECK ("latitude" >= -90 AND "latitude" <= 90),
	CONSTRAINT "chk_orders_lon_range" CHECK ("longitude" >= -180 AND "longitude" <= 180),
	CONSTRAINT "chk_orders_subtotal_non_negative" CHECK ("subtotal_amount" >= 0),
	CONSTRAINT "chk_orders_tax_non_negative" CHECK ("tax_amount" >= 0),
	CONSTRAINT "chk_orders_total_consistency" CHECK ("total_amount" = "subtotal_amount" + "tax_amount"),
	CONSTRAINT "chk_orders_rate_range" CHECK ("composite_tax_rate" >= 0 AND "composite_tax_rate" <= 1)
);
--> statement-breakpoint
CREATE TABLE "tax_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tax_rate_id" uuid,
	"jurisdiction_id" uuid,
	"order_id" uuid NOT NULL,
	"rate" numeric(10,6) NOT NULL,
	"amount" numeric(12,2) NOT NULL,
	"jurisdiction_name" text NOT NULL,
	"jurisdiction_kind" "jurisdiction_kind" NOT NULL,
	"jurisdiction_level" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_tax_lines_amount_non_negative" CHECK ("amount" >= 0),
	CONSTRAINT "chk_tax_lines_rate_range" CHECK ("rate" >= 0 AND "rate" <= 1),
	CONSTRAINT "chk_tax_lines_jurisdiction_name_not_blank" CHECK ("jurisdiction_name" = btrim("jurisdiction_name") AND "jurisdiction_name" <> ''),
	CONSTRAINT "chk_tax_lines_admin_requires_level" CHECK ("jurisdiction_kind" <> 'ADMINISTRATIVE' OR "jurisdiction_level" IS NOT NULL),
	CONSTRAINT "chk_tax_lines_level_allowed" CHECK ("jurisdiction_level" IS NULL OR "jurisdiction_level" IN (10, 20, 30))
);
--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP CONSTRAINT "chk_jurisdictions_level_presence";--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP CONSTRAINT "chk_jurisdictions_level_range";--> statement-breakpoint
ALTER TABLE "tax_rates" DROP CONSTRAINT "chk_tax_rates_rate_fraction_0_1";--> statement-breakpoint
CREATE INDEX "idx_orders_order_date" ON "orders" ("order_date");--> statement-breakpoint
CREATE INDEX "idx_tax_lines_order" ON "tax_lines" ("order_id");--> statement-breakpoint
CREATE INDEX "idx_tax_lines_jurisdiction" ON "tax_lines" ("jurisdiction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tax_lines_order_tax_rate" ON "tax_lines" ("order_id","tax_rate_id") WHERE "tax_rate_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_lines" ADD CONSTRAINT "tax_lines_tax_rate_id_tax_rates_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "tax_lines" ADD CONSTRAINT "tax_lines_jurisdiction_id_jurisdictions_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "tax_lines" ADD CONSTRAINT "tax_lines_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identifier_systems" ADD CONSTRAINT "chk_identifier_systems_key_lower" CHECK ("key" = lower("key"));--> statement-breakpoint
ALTER TABLE "jurisdiction_identifiers" ADD CONSTRAINT "chk_jurisdiction_identifiers_value_norm_lower" CHECK ("value_norm" = lower("value_norm"));--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD CONSTRAINT "chk_jurisdictions_admin_requires_level" CHECK ("kind" <> 'ADMINISTRATIVE' OR "level" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD CONSTRAINT "chk_jurisdictions_level_allowed" CHECK ("level" IS NULL OR "level" IN (10, 20, 30));--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD CONSTRAINT "chk_jurisdictions_boundary_not_empty" CHECK (NOT ST_IsEmpty("boundary"));--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD CONSTRAINT "chk_jurisdictions_boundary_valid" CHECK (ST_IsValid("boundary"));--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD CONSTRAINT "chk_jurisdictions_boundary_srid_4326" CHECK (ST_SRID("boundary") = 4326);--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "chk_tax_rates_rate_fraction_range" CHECK ("rate" >= 0 AND "rate" <= 1);--> statement-breakpoint
ALTER TABLE "identifier_systems" DROP CONSTRAINT "chk_identifier_systems_key_not_blank", ADD CONSTRAINT "chk_identifier_systems_key_not_blank" CHECK ("key" = btrim("key") AND "key" <> '');--> statement-breakpoint
ALTER TABLE "identifier_systems" DROP CONSTRAINT "chk_identifier_systems_name_not_blank", ADD CONSTRAINT "chk_identifier_systems_name_not_blank" CHECK ("name" = btrim("name") AND "name" <> '');--> statement-breakpoint
ALTER TABLE "jurisdiction_identifiers" DROP CONSTRAINT "chk_jurisdiction_identifiers_value_raw_not_blank", ADD CONSTRAINT "chk_jurisdiction_identifiers_value_raw_not_blank" CHECK ("value_raw" = btrim("value_raw") AND "value_raw" <> '');--> statement-breakpoint
ALTER TABLE "jurisdiction_identifiers" DROP CONSTRAINT "chk_jurisdiction_identifiers_value_norm_not_blank", ADD CONSTRAINT "chk_jurisdiction_identifiers_value_norm_not_blank" CHECK ("value_norm" = btrim("value_norm") AND "value_norm" <> '');--> statement-breakpoint
ALTER TABLE "jurisdiction_identifiers" DROP CONSTRAINT "chk_jurisdiction_identifiers_scope_not_blank", ADD CONSTRAINT "chk_jurisdiction_identifiers_scope_not_blank" CHECK ("scope" IS NULL OR ("scope" = btrim("scope") AND "scope" <> ''));--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP CONSTRAINT "chk_jurisdictions_name_not_blank", ADD CONSTRAINT "chk_jurisdictions_name_not_blank" CHECK ("name" = btrim("name") AND "name" <> '');