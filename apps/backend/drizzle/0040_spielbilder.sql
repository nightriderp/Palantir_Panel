CREATE TABLE "game_type_images" (
	"game_type_id" text NOT NULL,
	"kind" text NOT NULL,
	"data" "bytea" NOT NULL,
	"mime_type" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_id" uuid,
	CONSTRAINT "game_type_images_game_type_id_kind_pk" PRIMARY KEY("game_type_id","kind")
);
--> statement-breakpoint
ALTER TABLE "game_type_images" ADD CONSTRAINT "game_type_images_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_type_images_kind_idx" ON "game_type_images" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "game_type_images_uploaded_by_idx" ON "game_type_images" USING btree ("uploaded_by_id");