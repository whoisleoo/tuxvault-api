CREATE INDEX "idx_audit_created_at" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_user_id" ON "audit_log" USING btree ("user_id");