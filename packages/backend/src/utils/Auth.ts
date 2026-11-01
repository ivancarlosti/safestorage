import JWT from 'jsonwebtoken';
import { SETTINGS } from '@/structures/settings.js';

// The lifetime the cookie, the `expiresAt` of the login response and the
// frontend's own assumptions all agree on.
export const AUTH_TOKEN_MAX_AGE = 1000 * 60 * 60 * 24 * 30;

/*
	Both the password login and the keycloak callback have to mint the exact same
	token: the auth middleware compares `iat` (milliseconds here, not the
	JWT-standard seconds) against `passwordEditedAt`, so a second implementation
	would silently invalidate one of the two flows.
*/
export const signAuthToken = (userId: number) =>
	JWT.sign({ iss: 'safestorage', sub: userId, iat: Date.now() }, SETTINGS.secret ?? '', { expiresIn: '30d' });

/*
	reCAPTCHA is optional and off unless both the site key (shown on the form,
	exposed through `GET /api/settings`) and the secret (used here) are stored in
	the instance settings, so an instance without them behaves exactly like it
	always has.
*/
export const verifyRecaptcha = async (token: string | undefined): Promise<boolean> => {
	const { recaptchaSiteKey, recaptchaSecretKey } = SETTINGS;

	if (!recaptchaSiteKey || !recaptchaSecretKey) return true;
	if (!token) return false;

	const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ secret: recaptchaSecretKey, response: token })
	});

	if (!response.ok) return false;

	const result = (await response.json()) as { success?: boolean };
	return result.success === true;
};
