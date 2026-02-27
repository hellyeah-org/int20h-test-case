CREATE TYPE "jurisdiction_kind" AS ENUM('ADMINISTRATIVE', 'SPECIAL');--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD COLUMN "kind" "jurisdiction_kind" NOT NULL;--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD COLUMN "level" smallint;--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD CONSTRAINT "chk_jurisdictions_level_presence" CHECK (
        ("kind" = 'ADMINISTRATIVE' AND "level" IS NOT NULL) OR
        ("kind" <> 'ADMINISTRATIVE' AND "level" IS NULL)
      );--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD CONSTRAINT "chk_jurisdictions_level_range" CHECK ("level" IS NULL OR ("level" >= 0 AND "level" <= 10));--> statement-breakpoint
DROP TYPE "jurisdiction_type";