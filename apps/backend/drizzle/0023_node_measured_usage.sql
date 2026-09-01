ALTER TABLE "host_nodes" ADD COLUMN "measured_ram_available_mb" integer;--> statement-breakpoint
ALTER TABLE "host_nodes" ADD COLUMN "measured_disk_available_mb" integer;--> statement-breakpoint
ALTER TABLE "host_nodes" ADD COLUMN "measured_cpu_load_1m" double precision;--> statement-breakpoint
ALTER TABLE "host_nodes" ADD COLUMN "measured_at" timestamp with time zone;