import { createTransport } from 'nodemailer';
import { SETTINGS } from '@/structures/settings.js';
import { log, logError } from '@/utils/Logger.js';

/*
	Emails are optional: an instance without SMTP configured keeps working, the
	share endpoint simply returns the invite link so it can be copied by hand.
	The transport is cached until one of the connection settings changes, so a
	save from the admin panel takes effect on the next message without a restart.
*/

type MailTransport = ReturnType<typeof createTransport>;

export type MailResult = { error?: string; sent: boolean };

const trim = (value: string | undefined) => (value ?? '').trim();

export const isMailerConfigured = () =>
	Boolean(SETTINGS.smtpEnabled && trim(SETTINGS.smtpHost) && (trim(SETTINGS.smtpFrom) || trim(SETTINGS.smtpUser)));

let cachedTransport: { signature: string; transport: MailTransport } | undefined;

const getTransport = () => {
	const signature = [
		trim(SETTINGS.smtpHost),
		String(SETTINGS.smtpPort),
		String(SETTINGS.smtpSecure),
		trim(SETTINGS.smtpUser),
		SETTINGS.smtpPassword ?? ''
	].join('|');

	if (cachedTransport?.signature === signature) return cachedTransport.transport;

	const transport = createTransport({
		host: trim(SETTINGS.smtpHost),
		port: Number(SETTINGS.smtpPort) || 587,
		secure: Boolean(SETTINGS.smtpSecure),
		auth: trim(SETTINGS.smtpUser) ? { user: trim(SETTINGS.smtpUser), pass: SETTINGS.smtpPassword } : undefined,
		// A dead SMTP server should not hold the request open for minutes.
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 20_000
	});

	cachedTransport = { signature, transport };
	return transport;
};

/*
	The instance URL is what ends up in the emails, so it has to be absolute.
	When the setting is empty the origin of the browser request that triggered
	the email is used, which is the right host for every deployment behind a
	proxy without any extra configuration.
*/
export const getInstanceUrl = (fallbackOrigin?: string) => {
	const configured = (trim(SETTINGS.instanceUrl) || trim(fallbackOrigin)).replace(/\/+$/, '');
	if (!configured) return '';

	return /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
};

export const buildInstanceLink = (path: string, fallbackOrigin?: string) => {
	const base = getInstanceUrl(fallbackOrigin);
	if (!base) return '';

	return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};

// The address itself is PII, so only its domain is ever logged.
const domainOf = (email: string) => email.split('@')[1] ?? 'unknown';

export const sendMail = async ({
	html,
	subject,
	text,
	to
}: {
	html?: string;
	subject: string;
	text: string;
	to: string;
}): Promise<MailResult> => {
	if (!isMailerConfigured()) return { sent: false, error: 'Emails are not configured on this instance' };

	const from = trim(SETTINGS.smtpFrom) || trim(SETTINGS.smtpUser);

	try {
		await getTransport().sendMail({ from, html, subject, text, to });
		log.debug(`Sent an email to a @${domainOf(to)} address`);
		return { sent: true };
	} catch (error) {
		logError(log, 'Could not send an email', error);
		return { sent: false, error: error instanceof Error ? error.message : 'Unknown error' };
	}
};

/*
	Confirms the transport is reachable and the credentials are accepted, used by
	the "send test email" button of the admin panel.
*/
export const sendTestMail = async (to: string): Promise<MailResult> => {
	if (!isMailerConfigured()) return { sent: false, error: 'Emails are not configured on this instance' };

	try {
		await getTransport().verify();
	} catch (error) {
		logError(log, 'The SMTP configuration could not be verified', error);
		return { sent: false, error: error instanceof Error ? error.message : 'The SMTP server is unreachable' };
	}

	return sendMail({
		to,
		subject: `${SETTINGS.serviceName} - test email`,
		text: 'This is a test email sent from the safestorage admin panel. If you can read it, the email settings work.',
		html: '<p>This is a test email sent from the safestorage admin panel.</p><p>If you can read it, the email settings work.</p>'
	});
};

type AlbumShareMail = {
	albumName: string;
	albumUrl?: string;
	// The invite code is included even when no absolute link could be built.
	inviteCode?: string;
	inviteUrl?: string;
	inviter: string;
	kind: 'invite' | 'member' | 'onboard';
	to: string;
};

const escapeHtml = (value: string) =>
	value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export const sendAlbumShareMail = async ({
	albumName,
	albumUrl,
	inviteCode,
	inviteUrl,
	inviter,
	kind,
	to
}: AlbumShareMail): Promise<MailResult> => {
	const serviceName = SETTINGS.serviceName;

	const intro =
		kind === 'invite'
			? `${inviter} shared the album "${albumName}" with you on ${serviceName}. Create an account to access it:`
			: kind === 'onboard'
				? `${inviter} shared the album "${albumName}" with you on ${serviceName}. Sign in to access it:`
				: `${inviter} shared the album "${albumName}" with you on ${serviceName}.`;

	const link = kind === 'invite' ? inviteUrl : albumUrl;
	const missingLink =
		!link && kind !== 'member' ? ['Ask the person who shared the album for the invite link.', ''] : [];

	const lines = [intro, ''];

	if (link) lines.push(link, '');
	if (kind === 'invite' && inviteCode) lines.push(`Invite code: ${inviteCode}`, '');
	lines.push(...missingLink, `- ${serviceName}`);

	const htmlParts = [`<p>${escapeHtml(intro)}</p>`];
	if (link) htmlParts.push(`<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`);
	if (kind === 'invite' && inviteCode) htmlParts.push(`<p>Invite code: <code>${escapeHtml(inviteCode)}</code></p>`);
	if (!link && kind !== 'member') htmlParts.push('<p>Ask the person who shared the album for the invite link.</p>');
	htmlParts.push(`<p>- ${escapeHtml(serviceName)}</p>`);

	return sendMail({
		to,
		subject: `${inviter} shared the album "${albumName}" with you on ${serviceName}`,
		text: lines.join('\n'),
		html: htmlParts.join('\n')
	});
};
