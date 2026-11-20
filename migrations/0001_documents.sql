CREATE TABLE "document_create_receipts" (
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"key_digest" text NOT NULL,
	"fingerprint" text NOT NULL,
	"document_id" uuid NOT NULL,
	"snapshot" jsonb,
	"expires_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "document_create_receipts_organization_id_actor_user_id_key_digest_pk" PRIMARY KEY("organization_id","actor_user_id","key_digest")
);
--> statement-breakpoint
ALTER TABLE "document_create_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "documents" (
	"organization_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"space_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"status" text NOT NULL,
	"title" text,
	"body" text,
	"author_user_id" uuid,
	"created_at" timestamp (3) with time zone,
	"updated_at" timestamp (3) with time zone,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "documents_organization_id_id_pk" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "documents_version_check" CHECK ("documents"."version" between 1 and 9007199254740991),
	CONSTRAINT "documents_state_check" CHECK (("documents"."status" = 'active' and num_nonnulls("documents"."title", "documents"."body", "documents"."author_user_id", "documents"."created_at", "documents"."updated_at") = 5 and "documents"."deleted_at" is null) or ("documents"."status" = 'deleted' and num_nonnulls("documents"."title", "documents"."body", "documents"."author_user_id", "documents"."created_at", "documents"."updated_at") = 0 and "documents"."deleted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "document_create_receipts_global_expiry_idx" ON "document_create_receipts" USING btree ("expires_at","organization_id","actor_user_id","key_digest");--> statement-breakpoint
CREATE INDEX "document_create_receipts_document_idx" ON "document_create_receipts" USING btree ("organization_id","document_id");--> statement-breakpoint
CREATE INDEX "documents_catalog_idx" ON "documents" USING btree ("organization_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "documents"."status" = 'active';--> statement-breakpoint
CREATE INDEX "documents_space_idx" ON "documents" USING btree ("organization_id","space_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "documents"."status" = 'active';--> statement-breakpoint
CREATE POLICY "document_create_receipts_organization_isolation" ON "document_create_receipts" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "documents_organization_isolation" ON "documents" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');
--> statement-breakpoint
ALTER TABLE "document_create_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
