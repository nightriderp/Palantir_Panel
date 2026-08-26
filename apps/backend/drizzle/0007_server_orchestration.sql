CREATE TABLE "game_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"name" text NOT NULL,
	"game_type" text NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"status_message" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"crash_timestamps" text[] DEFAULT '{}' NOT NULL,
	"docker_container_id" text,
	"subdomain" text NOT NULL,
	"dns_record_id" text,
	"assigned_ports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resource_limits" jsonb NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"startup_parameters" text DEFAULT '' NOT NULL,
	"auto_shutdown" jsonb NOT NULL,
	"restart_required" boolean DEFAULT false NOT NULL,
	"cloned_from_server_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_members" (
	"server_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission_level" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_members_server_id_user_id_pk" PRIMARY KEY("server_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "game_servers" ADD CONSTRAINT "game_servers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_servers" ADD CONSTRAINT "game_servers_host_id_host_nodes_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."host_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_servers" ADD CONSTRAINT "game_servers_cloned_from_server_id_game_servers_id_fk" FOREIGN KEY ("cloned_from_server_id") REFERENCES "public"."game_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_server_id_game_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."game_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_servers_subdomain_idx" ON "game_servers" USING btree ("subdomain");--> statement-breakpoint
CREATE INDEX "game_servers_owner_id_idx" ON "game_servers" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "game_servers_host_id_idx" ON "game_servers" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "game_servers_status_idx" ON "game_servers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "game_servers_docker_container_id_idx" ON "game_servers" USING btree ("docker_container_id");--> statement-breakpoint
CREATE INDEX "server_members_user_id_idx" ON "server_members" USING btree ("user_id");