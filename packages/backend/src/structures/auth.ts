import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import process from 'node:process';
import bcrypt from 'bcryptjs';

/*
	Authentication is configured entirely through the environment: `AUTH_METHOD`
	selects which of the two supported methods is active and the variables below
	hold its parameters. Nothing here is read from the database, because the
	method decides which routes accept credentials at all.

	This module is deliberately side-effect free (no Prisma, no logging, no
	network): it only parses the environment once, and `validateAuthConfiguration`
	reports what is wrong so `Requirements` can stop the boot with a clear message
	instead of failing later on a request.
*/

export type AuthMethod = 'account' | 'keycloak';

const BCRYPT_HASH = /^\$2[aby]?\$\d{2}\$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

/*
	`.env` files are written by hand, so a value ends up quoted often enough
	(`ACCOUNT_PASSWORD="hunter2"`) that stripping a matching pair of quotes (and
	any surrounding whitespace) belongs here instead of in every caller.
*/
const unquote = (value: string) => {
	let result = value.trim();
	const quote = result[0];

	if (result.length >= 2 && (quote === '"' || quote === "'") && result.endsWith(quote)) {
		result = result.slice(1, -1).trim();
	}

	return result;
};

const splitEnvList = (value: string | undefined): string[] =>
	(value ?? '')
		.split(',')
		.map(entry => unquote(entry))
		.filter(Boolean);

// Emails are the identity of every account, so they are always normalised the
// same way before they are compared or stored.
export const normalizeEmail = (email: string) => unquote(email).toLowerCase();

export const isValidEmail = (value: string) => value.length <= MAX_EMAIL_LENGTH && EMAIL.test(value);

export const isBcryptHash = (value: string) => BCRYPT_HASH.test(value);

export const AUTH_METHOD: AuthMethod =
	unquote(process.env.AUTH_METHOD ?? '').toLowerCase() === 'keycloak' ? 'keycloak' : 'account';
export const isAccountMethod = AUTH_METHOD === 'account';
export const isKeycloakMethod = AUTH_METHOD === 'keycloak';

// --- Local accounts ---------------------------------------------------------

const ACCOUNT_LOGINS = splitEnvList(process.env.ACCOUNT_LOGIN).map(normalizeEmail);
const ACCOUNT_PASSWORDS = splitEnvList(process.env.ACCOUNT_PASSWORD);

export const ACCOUNT_ACCOUNTS = ACCOUNT_LOGINS.map((email, index) => ({
	email,
	password: ACCOUNT_PASSWORDS[index] ?? null
}));

export const isAccountConfigured = ACCOUNT_ACCOUNTS.length > 0;

// The first configured account is the one that owns the instance; the rest are
// handed out as regular users.
export const accountOwnerEmail = ACCOUNT_ACCOUNTS[0]?.email ?? null;

/*
	Passwords are compared in constant time: `timingSafeEqual` on the raw values
	when `ACCOUNT_PASSWORD` holds a plaintext password, `bcrypt.compare` when the
	deployment committed a hash instead (so the plaintext never has to sit in the
	`.env` file).
*/
const constantTimeEquals = (expected: string, received: string) => {
	const expectedBuffer = Buffer.from(expected);
	const receivedBuffer = Buffer.from(received);

	if (expectedBuffer.length !== receivedBuffer.length) return false;
	return timingSafeEqual(expectedBuffer, receivedBuffer);
};

export const verifyAccountPassword = async (email: string, password: string): Promise<boolean> => {
	const account = ACCOUNT_ACCOUNTS.find(entry => entry.email === normalizeEmail(email));
	if (!account?.password) return false;

	if (isBcryptHash(account.password)) return bcrypt.compare(password, account.password);
	return constantTimeEquals(account.password, password);
};

// --- reCAPTCHA --------------------------------------------------------------

export const RECAPTCHA_SITE_KEY = unquote(process.env.RECAPTCHA_CLIENTID ?? '');
export const RECAPTCHA_SECRET_KEY = unquote(process.env.RECAPTCHA_CLIENTSECRET ?? '');

// Both halves are required: the site key is what the form embeds, the secret is
// what verifies the answer, and a half-configured captcha only breaks logins.
export const recaptchaEnabled = Boolean(RECAPTCHA_SITE_KEY && RECAPTCHA_SECRET_KEY);

// --- Keycloak ---------------------------------------------------------------

export const KEYCLOAK_BASE_URL = unquote(process.env.KEYCLOAK_BASE_URL ?? '').replace(/\/+$/, '');
export const KEYCLOAK_REALM = unquote(process.env.KEYCLOAK_REALM ?? '');
export const KEYCLOAK_CLIENT_ID = unquote(process.env.KEYCLOAK_CLIENT_ID ?? '');
export const KEYCLOAK_CLIENT_SECRET = unquote(process.env.KEYCLOAK_CLIENT_SECRET ?? '');
export const KEYCLOAK_REDIRECT_URI = unquote(process.env.KEYCLOAK_REDIRECT_URI ?? '');

export const isKeycloakConfigured = Boolean(
	KEYCLOAK_BASE_URL && KEYCLOAK_REALM && KEYCLOAK_CLIENT_ID && KEYCLOAK_REDIRECT_URI
);

export const getKeycloakIssuer = () => `${KEYCLOAK_BASE_URL}/realms/${encodeURIComponent(KEYCLOAK_REALM)}`;

/*
	Keycloak publishes a discovery document per realm, but its well-known paths are
	part of the product contract (every version since 17 serves them), so the
	endpoints are assembled instead of fetched: the boot stays offline-capable and
	a provider outage cannot stop the backend from starting.
*/
export const getKeycloakEndpoints = () => {
	const base = `${getKeycloakIssuer()}/protocol/openid-connect`;

	return {
		authorization: `${base}/auth`,
		endSession: `${base}/logout`,
		jwks: `${base}/certs`,
		token: `${base}/token`
	};
};

/*
	The allow-list accepts either whole emails (`someone@example.com`) or bare
	domains (`example.com`), because an instance usually trusts a company domain
	rather than a fixed list of people.
*/
const KEYCLOAK_RESTRICT = splitEnvList(process.env.KEYCLOAK_RESTRICT).map(entry => entry.toLowerCase());

export const getKeycloakRestriction = () => [...KEYCLOAK_RESTRICT];

export const isKeycloakEmailAllowed = (email: string) => {
	const normalized = normalizeEmail(email);
	if (KEYCLOAK_RESTRICT.length === 0) return true;

	return KEYCLOAK_RESTRICT.some(entry =>
		entry.includes('@') ? entry === normalized : normalized.endsWith(`@${entry}`)
	);
};

// --- Validation -------------------------------------------------------------

export const validateAuthConfiguration = () => {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (process.env.AUTH_METHOD && process.env.AUTH_METHOD.toLowerCase() !== 'account' && !isKeycloakMethod) {
		warnings.push(`AUTH_METHOD "${process.env.AUTH_METHOD}" is not recognised, falling back to "account".`);
	}

	if (isKeycloakMethod) {
		if (!isKeycloakConfigured) {
			errors.push(
				'AUTH_METHOD=keycloak requires KEYCLOAK_BASE_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID and KEYCLOAK_REDIRECT_URI.'
			);
		}

		if (KEYCLOAK_RESTRICT.length === 0 && !isAccountConfigured) {
			errors.push(
				'AUTH_METHOD=keycloak needs KEYCLOAK_RESTRICT (or ACCOUNT_LOGIN) so that only allow-listed emails can sign in.'
			);
		}
	}

	if (isAccountMethod && !isAccountConfigured && !process.env.ADMIN_PASSWORD) {
		warnings.push(
			'No ACCOUNT_LOGIN is configured: the legacy "admin" user will be created from ADMIN_PASSWORD (or the default password).'
		);
	}

	const accountsWithoutPassword = ACCOUNT_ACCOUNTS.filter(account => !account.password).length;
	if (accountsWithoutPassword > 0) {
		warnings.push(
			`${accountsWithoutPassword} ACCOUNT_LOGIN entries have no matching ACCOUNT_PASSWORD and cannot use the login form.`
		);
	}

	if (ACCOUNT_PASSWORDS.length > ACCOUNT_LOGINS.length) {
		warnings.push(
			'There are more ACCOUNT_PASSWORD entries than ACCOUNT_LOGIN entries; the extra ones are ignored.'
		);
	}

	return { errors, warnings };
};
