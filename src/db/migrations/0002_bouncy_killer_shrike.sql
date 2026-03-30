CREATE INDEX "idx_files_parent_id" ON "files" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_files_path" ON "files" USING btree ("path");--> statement-breakpoint
CREATE INDEX "idx_files_owner" ON "files" USING btree ("owner_username");--> statement-breakpoint
CREATE INDEX "idx_files_trash" ON "files" USING btree ("in_trash");