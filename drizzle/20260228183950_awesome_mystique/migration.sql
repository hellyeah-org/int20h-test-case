CREATE TYPE "job_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"file_name" text NOT NULL,
	"status" "job_status" DEFAULT 'PENDING'::"job_status" NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "import_job_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "external_id" varchar(255);--> statement-breakpoint
CREATE INDEX "idx_orders_import_job" ON "orders" ("import_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_orders_external_id" ON "orders" ("external_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_import_job_id_import_jobs_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE SET NULL;