ALTER TABLE "users" ADD COLUMN "avatar_data" "bytea";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_mime_type" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_updated_at" timestamp with time zone;