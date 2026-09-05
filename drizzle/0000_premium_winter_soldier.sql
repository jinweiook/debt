CREATE TABLE "advances" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"person_id" bigint NOT NULL,
	"bill_id" bigint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"advance_date" date NOT NULL,
	"generated_account_id" bigint NOT NULL,
	"note" varchar(512),
	"created_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debt_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"person_id" bigint NOT NULL,
	"type" varchar(16) NOT NULL,
	"title" varchar(128) NOT NULL,
	"source" varchar(64),
	"principal_cents" bigint NOT NULL,
	"remaining_principal_cents" bigint NOT NULL,
	"interest_type" varchar(16) DEFAULT 'none' NOT NULL,
	"fixed_interest_cents" bigint,
	"annual_rate_bps" integer,
	"interest_mode" varchar(16) DEFAULT 'fixed' NOT NULL,
	"dynamic_plan" varchar(16),
	"accrued_interest_cents" bigint DEFAULT 0 NOT NULL,
	"paid_interest_cents" bigint DEFAULT 0 NOT NULL,
	"last_accrual_month" char(7),
	"start_date" date NOT NULL,
	"term_months" integer,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"origin" varchar(16) DEFAULT 'manual' NOT NULL,
	"advance_id" bigint,
	"note" varchar(512),
	"created_at" timestamp (3) DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installment_bills" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" bigint NOT NULL,
	"period_no" integer NOT NULL,
	"due_date" date NOT NULL,
	"principal_cents" bigint NOT NULL,
	"interest_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"paid_interest_cents" bigint DEFAULT 0 NOT NULL,
	"paid_principal_cents" bigint DEFAULT 0 NOT NULL,
	"advanced" smallint DEFAULT 0 NOT NULL,
	"advance_id" bigint,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"note" varchar(512)
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"username" varchar(64) PRIMARY KEY NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp (3),
	"updated_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"note" varchar(512),
	"contact" varchar(128),
	"default_repay_day" smallint,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp (3) DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repayments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"person_id" bigint NOT NULL,
	"target_type" varchar(16) NOT NULL,
	"bill_id" bigint,
	"account_id" bigint,
	"amount_cents" bigint NOT NULL,
	"interest_part_cents" bigint NOT NULL,
	"principal_part_cents" bigint NOT NULL,
	"batch_id" char(36),
	"repaid_at" date NOT NULL,
	"note" varchar(512),
	"created_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" varchar(64) NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(16) DEFAULT 'user' NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp (3) DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uk_advances_bill" ON "advances" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "idx_adv_person" ON "advances" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "idx_accounts_person" ON "debt_accounts" USING btree ("person_id","type","status");--> statement-breakpoint
CREATE INDEX "idx_accounts_status" ON "debt_accounts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_bill_account_period" ON "installment_bills" USING btree ("account_id","period_no");--> statement-breakpoint
CREATE INDEX "idx_bills_due" ON "installment_bills" USING btree ("due_date","status");--> statement-breakpoint
CREATE INDEX "idx_persons_owner" ON "persons" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "idx_persons_status" ON "persons" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_rep_person" ON "repayments" USING btree ("person_id","repaid_at");--> statement-breakpoint
CREATE INDEX "idx_rep_bill" ON "repayments" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "idx_rep_account" ON "repayments" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_users_username" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "users" USING btree ("status");