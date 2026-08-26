CREATE TABLE "auth_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider_user_id" text,
	"password_hash" text,
	"provider_display_name" text,
	"provider_avatar_url" text,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"totp_secret" text,
	"totp_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "auth_methods_type_check" CHECK ("auth_methods"."type" in ('password', 'discord', 'twitch', 'steam')),
	CONSTRAINT "auth_methods_shape_check" CHECK (("auth_methods"."type" = 'password' and "auth_methods"."password_hash" is not null and "auth_methods"."provider_user_id" is null)
          or ("auth_methods"."type" <> 'password' and "auth_methods"."provider_user_id" is not null and "auth_methods"."password_hash" is null)),
	CONSTRAINT "auth_methods_totp_password_only_check" CHECK ("auth_methods"."totp_secret" is null or "auth_methods"."type" = 'password')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"previous_refresh_token_hash" text,
	"device_info" text,
	"ip_hint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "auth_methods" ADD CONSTRAINT "auth_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_methods_provider_identity_idx" ON "auth_methods" USING btree ("type","provider_user_id") WHERE "auth_methods"."provider_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_methods_user_type_idx" ON "auth_methods" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "auth_methods_user_id_idx" ON "auth_methods" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_previous_refresh_token_hash_idx" ON "sessions" USING btree ("previous_refresh_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_idx" ON "users" USING btree (lower("username")) WHERE "users"."username" is not null;