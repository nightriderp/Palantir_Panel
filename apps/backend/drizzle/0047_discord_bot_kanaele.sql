CREATE TABLE "discord_owner_categories" (
	"user_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"channel_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_owner_categories_user_id_sequence_pk" PRIMARY KEY("user_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "discord_server_channels" (
	"server_id" uuid PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"status_message_id" text,
	"last_rendered_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
