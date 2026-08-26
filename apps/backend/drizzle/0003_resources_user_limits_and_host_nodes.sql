CREATE TABLE "host_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"wireguard_ip" text NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"total_ram_mb" integer NOT NULL,
	"total_cpu_cores" double precision NOT NULL,
	"total_disk_mb" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_nodes_name_unique" UNIQUE("name"),
	CONSTRAINT "host_nodes_wireguard_ip_unique" UNIQUE("wireguard_ip")
);
--> statement-breakpoint
CREATE TABLE "user_resource_limits" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"max_ram_mb" integer,
	"max_cpu_cores" double precision,
	"max_disk_mb" integer,
	"max_concurrent_servers" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_resource_limits" ADD CONSTRAINT "user_resource_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "host_nodes_status_idx" ON "host_nodes" USING btree ("status");