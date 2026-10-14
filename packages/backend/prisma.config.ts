import 'dotenv/config';
import process from 'node:process';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 no longer accepts `url` / `shadowDatabaseUrl` inside the datasource
 * block: the connection used by the CLI (migrate/deploy) is declared here, while
 * the runtime connection is handed to `PrismaClient` through a driver adapter
 * (see src/structures/database.ts).
 *
 * `DATABASE_URL` is a MariaDB/MySQL connection string, e.g.
 * `mysql://user:password@host:3306/safestorage`.
 *
 * `SHADOW_DATABASE_URL` is optional and only used by `prisma migrate dev`, which
 * creates a throwaway database to diff the schema against. It is never used by
 * `prisma migrate deploy`, so containers do not need it.
 */
export default defineConfig({
	schema: 'src/prisma/schema.prisma',
	datasource: {
		url: env('DATABASE_URL'),
		shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL
	}
});
