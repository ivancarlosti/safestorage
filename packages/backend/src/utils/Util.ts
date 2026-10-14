import { readFileSync } from 'node:fs';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import type { FastifyRequest } from 'fastify';
import randomstring from 'randomstring';
import { v4 as uuidv4 } from 'uuid';
import { ACCOUNT_ACCOUNTS, isAccountConfigured, isBcryptHash, isKeycloakMethod } from '@/structures/auth.js';
import prisma from '@/structures/database.js';
import { SETTINGS } from '@/structures/settings.js';
import { log } from '@/utils/Logger.js';

const basePackageJson = fileURLToPath(new URL('../../../../package.json', import.meta.url));
export const VERSION = JSON.parse(readFileSync(basePackageJson, 'utf8')).version;

export const getHost = (req: FastifyRequest) => `${req.protocol}://${req.headers.host}`;
export const getSafeStorageVersion = () => VERSION;

export const getUniqueAlbumIdentifier = () => {
	const retry: any = async (i = 0) => {
		const identifier = randomstring.generate({
			length: SETTINGS.generatedAlbumLength,
			capitalization: 'lowercase'
		});
		const exists = await prisma.links.findFirst({
			where: {
				identifier
			}
		});
		if (!exists) return identifier;
		/*
			It's funny but if you do i++ the asignment never gets done resulting in an infinite loop
		*/
		if (i < 5) return retry(i + 1);
		log.error('Couldnt allocate identifier for album');
		return null;
	};

	return retry();
};

// A function that adds spaces to the beginning of the string until there are 7 characters
export const addSpaces = (str: string, amount = 7) => {
	const spaces = amount - str.length;
	let newStr = '';
	for (let i = 0; i < spaces; i++) {
		newStr += ' ';
	}

	newStr += str;
	return newStr;
};

export const unlistenEmitters = (emitters: any[], eventName: string, listener?: (reason?: any) => void) => {
	if (!listener) return;
	for (const emitter of emitters) {
		if (!emitter) continue;
		emitter.off(eventName, listener);
	}
};

/*
	Creates the accounts declared through `ACCOUNT_LOGIN`, or the historical
	`admin` user when nothing is declared.

	The function is idempotent: existing rows are never touched (their password is
	the one the UI rotates, and re-seeding would silently roll it back on every
	restart). The very first `ACCOUNT_LOGIN` entry is the owner of the instance,
	the remaining ones are plain users.
*/
export const createAdminUserIfNotExists = async () => {
	// Nothing declared: keep the historical behaviour, where `ADMIN_PASSWORD`
	// seeds a single `admin` user the first time the database is empty. Under
	// keycloak there is nothing to seed, because the owner is provisioned by the
	// first allow-listed SSO login instead.
	if (!isAccountConfigured) {
		if (isKeycloakMethod) {
			log.info('>>>');
			log.info('');
			log.info(
				'No ACCOUNT_LOGIN is configured: the owner account will be created by the first allowed keycloak login.'
			);
			log.info('');
			log.info('>>>');
			return;
		}

		const ownerUser = await prisma.users.findFirst({
			where: {
				roles: {
					some: {
						name: 'owner'
					}
				}
			}
		});

		if (ownerUser) return;

		// Determine where the initial admin password comes from without ever
		// passing the secret (or a secret-derived value) to the logger below.
		const adminPasswordFromEnv = Boolean(process.env.ADMIN_PASSWORD);
		const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin';
		const hash = await bcrypt.hash(adminPassword, 10);
		await prisma.users.create({
			data: {
				uuid: uuidv4(),
				username: 'admin',
				password: hash,
				roles: {
					connect: [
						{
							name: 'owner'
						},
						{
							name: 'admin'
						}
					]
				}
			}
		});

		log.info('>>>');
		log.info('');
		log.info(
			adminPasswordFromEnv
				? 'Created the admin user "admin" with the password from the ADMIN_PASSWORD environment variable'
				: 'Created the admin user "admin" with the default password. Change it after the first login.'
		);
		log.info('');
		log.info('>>>');
		return;
	}

	const ownerExists = await prisma.users.findFirst({
		where: {
			roles: {
				some: {
					name: 'owner'
				}
			}
		}
	});

	let created = 0;
	for (const [index, account] of ACCOUNT_ACCOUNTS.entries()) {
		const existing = await prisma.users.findFirst({
			where: {
				username: account.email
			},
			select: {
				id: true
			}
		});

		if (existing) continue;

		/*
			An entry without a matching `ACCOUNT_PASSWORD` still gets a row (so the
			role is right and the account can be managed from the panel), but with a
			password nobody knows: the login form can never be used for it. A bcrypt
			hash in `ACCOUNT_PASSWORD` is stored as-is, so the plaintext never has
			to live in the file.
		*/
		const password = account.password ?? randomstring.generate(48);
		const hash = isBcryptHash(password) ? password : await bcrypt.hash(password, 10);

		// Only the owner slots are decided here: when another owner already
		// exists the instance is not new, so the declared accounts join as
		// regular users rather than silently gaining owner rights.
		const roles = index === 0 && !ownerExists ? ['owner', 'admin'] : ['user'];

		await prisma.users.create({
			data: {
				uuid: uuidv4(),
				username: account.email,
				password: hash,
				roles: {
					connect: roles.map(name => ({ name }))
				}
			}
		});

		created++;
	}

	if (created > 0) {
		log.info('>>>');
		log.info('');
		// Only the count is logged: the email addresses are PII.
		log.info(`Created ${created} account(s) from ACCOUNT_LOGIN.`);
		log.info('');
		log.info('>>>');
	}
};
