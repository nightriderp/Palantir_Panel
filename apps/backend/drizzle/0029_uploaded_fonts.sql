CREATE TABLE "uploaded_fonts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family" text NOT NULL,
	"label" text NOT NULL,
	"format" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"variable" boolean DEFAULT false NOT NULL,
	"monospace" boolean DEFAULT false NOT NULL,
	"weight_min" integer NOT NULL,
	"weight_max" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_id" uuid,
	"uploaded_by_display_name" text,
	CONSTRAINT "uploaded_fonts_weight_range" CHECK ("uploaded_fonts"."weight_min" >= 1 and "uploaded_fonts"."weight_max" <= 1000 and "uploaded_fonts"."weight_min" <= "uploaded_fonts"."weight_max")
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "ui_font_id" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "monospace_font_id" text;--> statement-breakpoint
ALTER TABLE "uploaded_fonts" ADD CONSTRAINT "uploaded_fonts_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uploaded_fonts_family_lower_idx" ON "uploaded_fonts" USING btree (lower("family"));