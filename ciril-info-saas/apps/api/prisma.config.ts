import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Single .env at the repository root (ciril-info-saas/.env); a local apps/api/.env may override.
config({ path: ['.env', '../../.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Migrations run as the schema owner. Runtime roles are configured in src/config.
    url: process.env['DATABASE_URL'],
  },
});
