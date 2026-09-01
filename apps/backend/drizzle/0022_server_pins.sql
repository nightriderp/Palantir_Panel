CREATE TABLE "server_pins" (
	"user_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_pins_user_id_server_id_pk" PRIMARY KEY("user_id","server_id")
);
--> statement-breakpoint
ALTER TABLE "server_pins" ADD CONSTRAINT "server_pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_pins" ADD CONSTRAINT "server_pins_server_id_game_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."game_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_pins_user_idx" ON "server_pins" USING btree ("user_id");