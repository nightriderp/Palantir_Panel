ALTER TABLE "host_nodes" ADD COLUMN "agent_token_hash" text;--> statement-breakpoint
ALTER TABLE "host_nodes" ADD CONSTRAINT "host_nodes_agent_token_hash_unique" UNIQUE("agent_token_hash");