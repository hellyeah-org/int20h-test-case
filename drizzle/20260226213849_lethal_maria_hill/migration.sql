CREATE TYPE "jurisdiction_type" AS ENUM('STATE', 'COUNTY', 'CITY', 'SPECIAL');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"type" "jurisdiction_type" NOT NULL,
	"fips_code" varchar(20),
	"nys_reporting_code" varchar(10),
	"boundary" geometry(point,4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_jurisdictions_name_not_blank" CHECK (btrim("name") <> ''),
	CONSTRAINT "chk_jurisdictions_fips_numeric_or_null" CHECK ("fips_code" IS NULL OR "fips_code" ~ '^[0-9]+$'),
	CONSTRAINT "chk_jurisdictions_fips_length_by_type" CHECK (
        "fips_code" IS NULL OR
        ("type" = 'STATE'  AND char_length("fips_code") = 2) OR
        ("type" = 'COUNTY' AND char_length("fips_code") = 5) OR
        ("type" = 'CITY'   AND char_length("fips_code") = 7) OR
        ("type" = 'SPECIAL')
      )
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"jurisdiction_id" uuid NOT NULL,
	"rate" numeric(10,6) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_tax_rates_rate_fraction_0_1" CHECK ("rate" >= 0 AND "rate" <= 1),
	CONSTRAINT "chk_tax_rates_effective_to_gt_from" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from")
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_jurisdictions_fips_code" ON "jurisdictions" ("fips_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_jurisdictions_nys_reporting_code" ON "jurisdictions" ("nys_reporting_code");--> statement-breakpoint
CREATE INDEX "idx_jurisdictions_boundary_gist" ON "jurisdictions" USING gist ("boundary");--> statement-breakpoint
CREATE INDEX "idx_jurisdictions_name_trgm_gin" ON "jurisdictions" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_tax_rates_jurisdiction_from" ON "tax_rates" ("jurisdiction_id","effective_from");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_jurisdiction_id_jurisdictions_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id") ON DELETE CASCADE;