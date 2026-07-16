CREATE TABLE "retrieval_attempts" (
	"secret_id" text NOT NULL,
	"ip_hash" text NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retrieval_attempts_secret_id_ip_hash_pk" PRIMARY KEY("secret_id","ip_hash")
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"ciphertext" "bytea",
	"nonce" "bytea",
	"salt" "bytea",
	"public_key" "bytea",
	"challenge" "bytea",
	"challenge_expires_at" timestamp with time zone,
	"created_from_safe" boolean DEFAULT false NOT NULL,
	"expires_in" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sealed_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "secrets_ciphertext_size" CHECK ("secrets"."ciphertext" IS NULL OR octet_length("secrets"."ciphertext") <= 8192)
);
--> statement-breakpoint
ALTER TABLE "retrieval_attempts" ADD CONSTRAINT "retrieval_attempts_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retrieval_attempts_locked_until_idx" ON "retrieval_attempts" USING btree ("locked_until");--> statement-breakpoint
CREATE INDEX "secrets_expires_at_idx" ON "secrets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "secrets_state_idx" ON "secrets" USING btree ("state");