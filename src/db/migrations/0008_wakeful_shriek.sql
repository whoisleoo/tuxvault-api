CREATE TABLE "blocked_ips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" text NOT NULL,
	"reason" text DEFAULT 'honeypot' NOT NULL,
	"blocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "blocked_ips_ip_unique" UNIQUE("ip")
);
--> statement-breakpoint
CREATE INDEX "idx_blocked_ips_ip" ON "blocked_ips" USING btree ("ip");