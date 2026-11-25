CREATE TABLE "role_permissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"role_id" bigint NOT NULL,
	"permission_code" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(255),
	"data_scope" varchar(16) DEFAULT 'self' NOT NULL,
	"is_system" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "note" varchar(512);--> statement-breakpoint
CREATE UNIQUE INDEX "uk_role_perm" ON "role_permissions" USING btree ("role_id","permission_code");--> statement-breakpoint
CREATE INDEX "idx_role_perm_role" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_roles_code" ON "roles" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_user_role" ON "user_roles" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE INDEX "idx_user_role_user" ON "user_roles" USING btree ("user_id");