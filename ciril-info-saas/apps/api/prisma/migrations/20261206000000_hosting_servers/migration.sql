-- Several hosting servers (HOSTING_PROVIDER=servers): each server's connection details live here, credentials encrypted.
ALTER TABLE "hosting_servers" ADD COLUMN "port" INTEGER;
ALTER TABLE "hosting_servers" ADD COLUMN "username" VARCHAR(64);
ALTER TABLE "hosting_servers" ADD COLUMN "tls" VARCHAR(8) NOT NULL DEFAULT 'verify';
ALTER TABLE "hosting_servers" ADD COLUMN "last_checked_at" TIMESTAMPTZ(3);
ALTER TABLE "hosting_servers" ADD COLUMN "last_check" VARCHAR(255);

-- A plan can be limited to one kind of panel (its package exists only there). Null: any server.
ALTER TABLE "plans" ADD COLUMN "hosting_panel" "HostingPanel";
