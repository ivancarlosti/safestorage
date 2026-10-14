import process from 'node:process';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@/generated/prisma/client.js';

/*
	Prisma 7 ships the Rust-free client, which has no bundled query engine: the
	database connection is opened by a driver adapter instead. `PrismaMariaDb`
	talks to MariaDB/MySQL through the pure-JS `mariadb` driver, so the container
	image needs no native build toolchain.

	The adapter takes a connection string, and the same `DATABASE_URL` is used by
	the Prisma CLI (see packages/backend/prisma.config.ts) and by the container.
*/
const adapter = new PrismaMariaDb(process.env.DATABASE_URL as string);

const prisma = new PrismaClient({ adapter });

export default prisma;
