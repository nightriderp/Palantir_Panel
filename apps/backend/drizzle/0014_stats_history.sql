CREATE TABLE "server_stats_samples" (
	"server_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"cpu_percent" double precision,
	"ram_used_mb" integer,
	"disk_used_mb" integer,
	"ping_ms" integer,
	"players_online" integer,
	"players_max" integer,
	"network_rx_bytes" bigint,
	"network_tx_bytes" bigint,
	CONSTRAINT "server_stats_samples_server_id_recorded_at_pk" PRIMARY KEY("server_id","recorded_at")
);
--> statement-breakpoint
ALTER TABLE "server_stats_samples" ADD CONSTRAINT "server_stats_samples_server_id_game_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."game_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_stats_samples_recorded_idx" ON "server_stats_samples" USING btree ("recorded_at");