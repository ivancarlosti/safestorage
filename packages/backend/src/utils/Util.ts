import { readFileSync } from 'node:fs';
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
	Creates the accounts declared through `ACCOUNT_LOGIN`.

	There is no implicit default account: an instance that declares none is left
	without users, which means it cannot be signed into until one is declared
	through `ACCOUNT_LOGIN`/`ACCOUNT_PASSWORD` (or, under keycloak, until the first
	allow-listed SSO login provisions the owner).

	The function is idempotent: existing rows are never touched (their password is
	the one the UI rotates, and re-seeding would silently roll it back on every
	restart). The very first `ACCOUNT_LOGIN` entry is the owner of the instance,
	the remaining ones are plain users.
*/
export const createConfiguredAccounts = async () => {
	// Nothing declared: nothing is seeded. Under keycloak the owner is provisioned
	// by the first allow-listed SSO login, and a database that already holds users
	// (including the legacy `admin` row) keeps working as it is.
	if (!isAccountConfigured) {
		log.info('>>>');
		log.info('');

		if (isKeycloakMethod) {
			log.info(
				'No ACCOUNT_LOGIN is configured: the owner account will be created by the first allowed keycloak login.'
			);
		} else if ((await prisma.users.count()) === 0) {
			log.warn('No ACCOUNT_LOGIN is configured and the database has no users, so nobody can sign in.');
			log.warn('Declare ACCOUNT_LOGIN (and ACCOUNT_PASSWORD) and restart the instance.');
		} else {
			log.info('No ACCOUNT_LOGIN is configured: sign in with an account already stored in the database.');
		}

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
