CREATE INDEX "quota_requests_user_id_idx" ON "quota_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "quota_requests_decided_by_id_idx" ON "quota_requests" USING btree ("decided_by_id");--> statement-breakpoint
CREATE INDEX "server_pins_server_idx" ON "server_pins" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "backups_created_by_user_id_idx" ON "backups" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "backups_schedule_id_idx" ON "backups" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "schedules_server_id_idx" ON "schedules" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_rule_id_idx" ON "notification_deliveries" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "notifications_rule_id_idx" ON "notifications" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "conversation_reads_user_id_idx" ON "conversation_reads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_reports_reported_by_id_idx" ON "message_reports" USING btree ("reported_by_id");--> statement-breakpoint
CREATE INDEX "message_reports_resolved_by_id_idx" ON "message_reports" USING btree ("resolved_by_id");--> statement-breakpoint
CREATE INDEX "messages_deleted_by_id_idx" ON "messages" USING btree ("deleted_by_id") WHERE "messages"."deleted_by_id" is not null;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_singleton" CHECK ("instance_settings"."id" = 1);