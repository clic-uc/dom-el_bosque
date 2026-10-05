CREATE TYPE "public"."attachment_entity" AS ENUM('record', 'polygon');--> statement-breakpoint
CREATE TYPE "public"."attachment_kind" AS ENUM('link', 'file');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'IMPORT', 'REVERT', 'ASSIGN_NUMBER');--> statement-breakpoint
CREATE TYPE "public"."audit_entity" AS ENUM('LAYER', 'RECORD', 'ROLE', 'ROLE_OPERATION', 'USER', 'POLYGON', 'ATTACHMENT', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."coords_source" AS ENUM('role', 'own', 'geocoded');--> statement-breakpoint
CREATE TYPE "public"."department" AS ENUM('edificacion', 'ejecucion', 'emergencias', 'vivienda');--> statement-breakpoint
CREATE TYPE "public"."duplicate_strategy" AS ENUM('ask', 'skip', 'update');--> statement-breakpoint
CREATE TYPE "public"."import_row_action" AS ENUM('created', 'updated');--> statement-breakpoint
CREATE TYPE "public"."import_row_resolution" AS ENUM('create', 'update', 'skip');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('valid', 'warning', 'duplicate', 'error', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('UPLOADED', 'ANALYZING', 'REVIEW', 'COMMITTING', 'COMPLETED', 'FAILED', 'DISCARDED', 'REVERTED');--> statement-breakpoint
CREATE TYPE "public"."polygon_kind" AS ENUM('comuna', 'sector', 'villa');--> statement-breakpoint
CREATE TYPE "public"."role_operation_side" AS ENUM('origin', 'result');--> statement-breakpoint
CREATE TYPE "public"."role_operation_type" AS ENUM('subdivision', 'fusion', 'rectificacion', 'modificacion');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"must_change_password" boolean DEFAULT false NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layers" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"department" "department" NOT NULL,
	"has_role" boolean DEFAULT false NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unique_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"address_field_key" varchar(80),
	"heatmap_field_key" varchar(80),
	"icon" varchar(50) DEFAULT 'building-2' NOT NULL,
	"icon_color" varchar(20) DEFAULT '#3b82f6' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" varchar(11) PRIMARY KEY NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"address" text,
	"address_norm" text,
	"street_norm" text,
	"house_number" integer,
	"superseded_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layer_counters" (
	"layer_id" integer NOT NULL,
	"field_key" varchar(80) NOT NULL,
	"period" varchar(4) DEFAULT '' NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layer_counters_layer_id_field_key_period_pk" PRIMARY KEY("layer_id","field_key","period")
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" serial PRIMARY KEY NOT NULL,
	"layer_id" integer NOT NULL,
	"role_id" varchar(11),
	"lat" double precision,
	"lon" double precision,
	"geom" geometry(Point,4326) GENERATED ALWAYS AS (CASE WHEN lon IS NOT NULL THEN ST_SetSRID(ST_MakePoint(lon, lat), 4326) END) STORED,
	"coords_source" "coords_source",
	"geocode" jsonb,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"comments" text,
	"number_assigned_at" timestamp with time zone,
	"number_assigned_by" varchar(64),
	"created_by" varchar(64),
	"updated_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "records_coords_pair" CHECK ((lat IS NULL) = (lon IS NULL) AND (lat IS NULL) = (coords_source IS NULL)),
	CONSTRAINT "records_coords_role" CHECK (coords_source <> 'role' OR role_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "role_operation_roles" (
	"operation_id" integer NOT NULL,
	"role_id" varchar(11) NOT NULL,
	"side" "role_operation_side" NOT NULL,
	CONSTRAINT "role_operation_roles_operation_id_role_id_side_pk" PRIMARY KEY("operation_id","role_id","side")
);
--> statement-breakpoint
CREATE TABLE "role_operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "role_operation_type" NOT NULL,
	"effective_date" date NOT NULL,
	"reference" varchar(200),
	"record_id" integer,
	"comment" text,
	"created_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geocode_cache" (
	"provider" varchar(20) NOT NULL,
	"query" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geocode_cache_provider_query_pk" PRIMARY KEY("provider","query")
);
--> statement-breakpoint
CREATE TABLE "polygons" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "polygon_kind" NOT NULL,
	"code" varchar(50),
	"name" varchar(200),
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"geom" geometry(MultiPolygon,4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "attachment_entity" NOT NULL,
	"entity_id" varchar(64) NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"title" varchar(200) NOT NULL,
	"url" text,
	"storage_key" text,
	"file_name" varchar(255),
	"mime_type" varchar(120),
	"size_bytes" integer,
	"created_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_kind_fields" CHECK ((kind = 'link' AND url IS NOT NULL) OR (kind = 'file' AND storage_key IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "import_removals" (
	"import_id" uuid NOT NULL,
	"record_id" integer NOT NULL,
	"deletable" boolean NOT NULL,
	"reason" varchar(200),
	"resolution" varchar(6) DEFAULT 'keep' NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"snapshot" jsonb,
	CONSTRAINT "import_removals_import_id_record_id_pk" PRIMARY KEY("import_id","record_id")
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"parsed" jsonb,
	"status" "import_row_status" NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duplicate_of" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_duplicate_of" integer,
	"resolution" "import_row_resolution",
	"update_target_id" integer,
	"record_id" integer,
	"action" "import_row_action",
	"previous_snapshot" jsonb,
	CONSTRAINT "import_rows_import_id_row_number_pk" PRIMARY KEY("import_id","row_number")
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layer_id" integer NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"user_email" varchar(255),
	"file_name" varchar(500) NOT NULL,
	"file_type" varchar(4) NOT NULL,
	"file_key" text,
	"sheet_name" varchar(120),
	"header_row" integer DEFAULT 1 NOT NULL,
	"delimiter" varchar(1),
	"column_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_from" integer,
	"row_to" integer,
	"duplicate_strategy" "duplicate_strategy" DEFAULT 'ask' NOT NULL,
	"keep_existing_on_empty" boolean DEFAULT true NOT NULL,
	"full_replace" boolean DEFAULT false NOT NULL,
	"geocode" boolean DEFAULT true NOT NULL,
	"status" "import_status" DEFAULT 'UPLOADED' NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"deleted_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analyzed_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"reverted_at" timestamp with time zone,
	"reverted_by" varchar(64),
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"user_email" varchar(255),
	"action" "audit_action" NOT NULL,
	"entity_type" "audit_entity" NOT NULL,
	"entity_id" varchar(64) NOT NULL,
	"layer_id" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_counters" ADD CONSTRAINT "layer_counters_layer_id_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_layer_id_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_operation_roles" ADD CONSTRAINT "role_operation_roles_operation_id_role_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."role_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_operation_roles" ADD CONSTRAINT "role_operation_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_operations" ADD CONSTRAINT "role_operations_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_removals" ADD CONSTRAINT "import_removals_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_layer_id_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_name_idx" ON "users" USING btree ("name");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "roles_address_norm_trgm" ON "roles" USING gin ("address_norm" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "roles_street_number_idx" ON "roles" USING btree ("street_norm","house_number");--> statement-breakpoint
CREATE INDEX "records_layer_idx" ON "records" USING btree ("layer_id");--> statement-breakpoint
CREATE INDEX "records_role_idx" ON "records" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "records_layer_role_idx" ON "records" USING btree ("layer_id","role_id");--> statement-breakpoint
CREATE INDEX "records_geom_gist" ON "records" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "records_attributes_gin" ON "records" USING gin ("attributes");--> statement-breakpoint
CREATE INDEX "records_layer_updated_idx" ON "records" USING btree ("layer_id","updated_at");--> statement-breakpoint
CREATE INDEX "role_operation_roles_role_idx" ON "role_operation_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "polygons_geom_gist" ON "polygons" USING gist ("geom");--> statement-breakpoint
CREATE UNIQUE INDEX "polygons_kind_code_uq" ON "polygons" USING btree ("kind","code");--> statement-breakpoint
CREATE INDEX "attachments_entity_idx" ON "attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "import_rows_import_status_idx" ON "import_rows" USING btree ("import_id","status");--> statement-breakpoint
CREATE INDEX "imports_layer_created_idx" ON "imports" USING btree ("layer_id","created_at");--> statement-breakpoint
CREATE INDEX "imports_user_created_idx" ON "imports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "imports_status_idx" ON "imports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_logs_user_created_idx" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");