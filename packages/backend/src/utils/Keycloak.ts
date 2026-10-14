import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import JWT from 'jsonwebtoken';
import randomstring from 'randomstring';
import { v4 as uuidv4 } from 'uuid';
import {
	KEYCLOAK_CLIENT_ID,
	KEYCLOAK_CLIENT_SECRET,
	KEYCLOAK_REDIRECT_URI,
	accountOwnerEmail,
	getKeycloakEndpoints,
	getKeycloakIssuer
} from '@/structures/auth.js';
import prisma from '@/structures/database.js';
import { log } from '@/utils/Logger.js';

interface PendingAuthorization {
	codeVerifier: string;
	createdAt: number;
	nonce: string;
}

interface KeycloakIdentity {
	email: string;
	emailVerified: boolean;
}

/*
	`state` → PKCE verifier + nonce for the redirect that is currently in flight.
	Entries are single use (consumed by the callback) and expire after ten
	minutes, which is longer than any realistic round-trip through the provider.

	This lives in the process memory, so the flow is single-instance; the shipped
	image runs nginx, the backend and the frontend in one container, so that
	matches. A multi-replica deployment would need shared state (or sticky
	sessions) instead.
*/
const PENDING_TTL = 1000 * 60 * 10;
const pendingAuthorizations = new Map<string, PendingAuthorization>();

const base64Url = (buffer: Buffer) =>
	buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

const dropExpiredAuthorizations = () => {
	const now = Date.now();
	for (const [state, entry] of pendingAuthorizations) {
		if (now - entry.createdAt > PENDING_TTL) pendingAuthorizations.delete(state);
	}
};

/*
	Starts an Authorization Code + PKCE login: the code is only exchanged later by
	the callback, which is what makes the frontend able to be a plain redirect.
*/
export const createAuthorizationUrl = () => {
	dropExpiredAuthorizations();

	const state = base64Url(randomBytes(32));
	const nonce = base64Url(randomBytes(32));
	const codeVerifier = base64Url(randomBytes(64));
	const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());

	pendingAuthorizations.set(state, { codeVerifier, createdAt: Date.now(), nonce });

	const params = new URLSearchParams({
		client_id: KEYCLOAK_CLIENT_ID,
		redirect_uri: KEYCLOAK_REDIRECT_URI,
		response_type: 'code',
		scope: 'openid email profile',
		state,
		nonce,
		code_challenge: codeChallenge,
		code_challenge_method: 'S256'
	});

	return `${getKeycloakEndpoints().authorization}?${params.toString()}`;
};

// Removes the entry as it returns it, so a replayed `state` can never pass twice.
export const consumePendingAuthorization = (state: string) => {
	const entry = pendingAuthorizations.get(state);
	if (!entry) return null;

	pendingAuthorizations.delete(state);
	if (Date.now() - entry.createdAt > PENDING_TTL) return null;

	return entry;
};

export const exchangeCode = async (code: string, codeVerifier: string) => {
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		code,
		redirect_uri: KEYCLOAK_REDIRECT_URI,
		client_id: KEYCLOAK_CLIENT_ID,
		code_verifier: codeVerifier
	});

	// Only confidential clients have a secret; PKCE alone is enough for a public
	// one, so an empty value is not an error.
	if (KEYCLOAK_CLIENT_SECRET) body.set('client_secret', KEYCLOAK_CLIENT_SECRET);

	const response = await fetch(getKeycloakEndpoints().token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body
	});

	if (!response.ok) throw new Error(`The keycloak token endpoint answered ${response.status}`);

	return (await response.json()) as { id_token?: string };
};

/*
	Realm signing keys, cached because the callback is a hot path and the realm
	rotates its keys rarely. A `kid` that is not in the cache forces one refetch,
	which is how a rotation is picked up.
*/
const JWKS_TTL = 1000 * 60 * 5;
let signingKeyCache: { fetchedAt: number; keys: any[] } | null = null;

const fetchSigningKeys = async () => {
	const response = await fetch(getKeycloakEndpoints().jwks);
	if (!response.ok) throw new Error(`The keycloak JWKS endpoint answered ${response.status}`);

	const body = (await response.json()) as { keys?: any[] };
	return body.keys ?? [];
};

const getCachedSigningKey = (kid: string | undefined) => {
	if (!signingKeyCache || Date.now() - signingKeyCache.fetchedAt > JWKS_TTL) return null;

	return (kid ? signingKeyCache.keys.find(key => key.kid === kid) : signingKeyCache.keys[0]) ?? null;
};

const getSigningKey = async (kid: string | undefined) => {
	let jwk = getCachedSigningKey(kid);

	// A miss means either a stale cache or a key that was rotated in since the
	// last fetch; both are answered by refetching once. A second miss is a real
	// verification failure and propagates to the caller.
	if (!jwk) {
		const keys = await fetchSigningKeys();
		signingKeyCache = { fetchedAt: Date.now(), keys };

		jwk = (kid ? keys.find(key => key.kid === kid) : keys[0]) ?? null;
	}

	if (!jwk) throw new Error('No matching signing key in the keycloak JWKS');

	return createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' }) as string;
};

/*
	The `id_token` is the only thing that proves who just signed in, so it is
	verified rather than decoded: RS256 signature against the realm keys, `iss`,
	`exp` (jsonwebtoken), the `nonce` from the redirect that started this flow and
	the client id (`azp` normally, `aud` when the provider is configured to put it
	there). No profile claims are trusted beyond the email.
*/
export const verifyIdToken = async (idToken: string, nonce: string): Promise<KeycloakIdentity> => {
	const decoded = JWT.decode(idToken, { complete: true });
	const key = await getSigningKey(decoded?.header?.kid);

	const payload = JWT.verify(idToken, key, {
		algorithms: ['RS256'],
		issuer: getKeycloakIssuer()
	}) as { aud?: string | string[]; azp?: string; email?: string; email_verified?: boolean; nonce?: string };

	if (payload.nonce !== nonce) throw new Error('The keycloak id_token nonce does not match');

	const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (payload.azp !== KEYCLOAK_CLIENT_ID && !audiences.includes(KEYCLOAK_CLIENT_ID)) {
		throw new Error('The keycloak id_token was issued for another client');
	}

	if (!payload.email) throw new Error('The keycloak id_token does not contain an email');

	return { email: payload.email, emailVerified: payload.email_verified === true };
};

/*
	Just-in-time provisioning. The email is the identity, so it is looked up as
	the `username`; a user that has never signed in gets a row with a random
	password hash, which keeps the non-null column satisfied while making the
	password form unusable for it.

	Only the first account of the instance (either the one configured through
	`ACCOUNT_LOGIN` or, when that is empty, whoever signs in first) becomes the
	owner; everyone else is a plain user and is promoted from the admin panel.
*/
export const findOrCreateKeycloakUser = async (email: string) => {
	const username = email.toLowerCase();

	const existing = await prisma.users.findFirst({
		where: { username },
		include: { roles: { select: { name: true } } }
	});

	if (existing) return existing;

	const ownerExists = await prisma.users.findFirst({
		where: { roles: { some: { name: 'owner' } } },
		select: { id: true }
	});

	const becomesOwner = !ownerExists && (!accountOwnerEmail || accountOwnerEmail === username);
	const roleNames = becomesOwner ? ['owner', 'admin'] : ['user'];

	const password = await bcrypt.hash(randomstring.generate(48), 10);

	const user = await prisma.users.create({
		data: {
			uuid: uuidv4(),
			username,
			password,
			roles: {
				connect: roleNames.map(name => ({ name }))
			}
		},
		include: { roles: { select: { name: true } } }
	});

	// The id is logged instead of the email: the rest of the backend treats the
	// username as PII and only uses the id to correlate requests.
	log.info(
		becomesOwner
			? `The first keycloak login created the owner account (user ${user.id})`
			: `A keycloak login provisioned a new account (user ${user.id})`
	);

	return user;
};
