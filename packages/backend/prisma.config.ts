import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 no longer accepts `url` / `shadowDatabaseUrl` inside the datasource
 * block: the connection used by the CLI (migrate/deploy) is declared here, while
 * the runtime connection is passed to `PrismaClient` through a driver adapter.
 *
 * Both paths are derived from this file so they resolve identically from the
 * repository checkout and from the container (/app/packages/backend -> /app).
 */
const packageRoot = fileURLToPath(new URL('.', import.meta.url));
const databaseDir = path.join(packageRoot, '..', '..', 'database');

export default defineConfig({
	schema: 'src/prisma/schema.prisma',
	datasource: {
		url: `file:${path.join(databaseDir, 'database.sqlite')}`,
		shadowDatabaseUrl: `file:${path.join(databaseDir, 'shadow.sqlite')}`
	}
});
