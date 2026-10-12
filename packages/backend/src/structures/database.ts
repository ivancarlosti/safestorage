import { URL, fileURLToPath } from 'node:url';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@/generated/prisma/client.js';

/*
	Prisma 7 ships the Rust-free client, which has no bundled query engine: the
	database connection is opened by a driver adapter instead (better-sqlite3
	here). The `file:` prefix is stripped by the adapter itself.
*/
const adapter = new PrismaBetterSqlite3({
	url: `file:${fileURLToPath(new URL('../../../../database/database.sqlite', import.meta.url))}`
});

const prisma = new PrismaClient({ adapter });

export default prisma;
