CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"file_id" uuid,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"extra" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"parent_id" uuid,
	"is_directory" boolean NOT NULL,
	"size" bigint,
	"mime_type" text,
	"extension" text,
	"owner_username" text NOT NULL,
	"favorited" boolean DEFAULT false NOT NULL,
	"in_trash" boolean DEFAULT false NOT NULL,
	"trashed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "pending_2fa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"ip_address" text,
	"approved" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_parent_id_files_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;