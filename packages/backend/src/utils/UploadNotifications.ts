import { isValidEmail } from '@/structures/auth.js';
import prisma from '@/structures/database.js';
import { SETTINGS } from '@/structures/settings.js';
import { log, logError } from '@/utils/Logger.js';
import { buildInstanceLink, isMailerConfigured, sendUploadNotificationMail } from '@/utils/Mailer.js';
import type { UploadTarget } from '@/utils/UploadHelpers.js';

/*
	Upload notifications are opt-in and best-effort. They are sent after the
	upload response, so a slow or broken SMTP server never fails or delays an
	upload, and a recipient that cannot be resolved is simply skipped.

	Two separate audiences:

	- anonymous uploads on the main dashboard go to the instance owner
	  (`anonymousUploadNotificationsEnabled`),
	- uploads through a public album link go to the album owner and its members
	  (`albums.notifyOnPublicUpload`).

	Signed-in uploads into an album notify nobody.
*/

type UploadNotificationInput = {
	file: { name: string; original: string; size: number | string; type: string };
	links: { preview?: string; thumb?: string; url: string };
	origin?: string;
	target: UploadTarget;
	uploader?: string;
};

const albumNotificationContext = async (albumId: number) => {
	const album = await prisma.albums.findFirst({
		where: { id: albumId },
		select: {
			name: true,
			notifyOnPublicUpload: true,
			userId: true,
			uuid: true,
			members: {
				select: {
					user: {
						select: {
							enabled: true,
							username: true
						}
					}
				}
			}
		}
	});

	if (!album?.notifyOnPublicUpload) return null;

	// `albums.userId` has no relation in the schema, so the owner is looked up on its own
	const owner = await prisma.users.findFirst({
		where: { id: album.userId },
		select: {
			enabled: true,
			username: true
		}
	});

	return {
		album,
		users: [owner, ...album.members.map(member => member.user)]
	};
};

const anonymousNotificationContext = async () => {
	const owners = await prisma.users.findMany({
		where: {
			enabled: true,
			roles: {
				some: {
					name: 'owner'
				}
			}
		},
		select: {
			enabled: true,
			username: true
		}
	});

	return { album: null, users: owners };
};

export const notifyUpload = async ({ file, links, origin, target, uploader }: UploadNotificationInput) => {
	try {
		// Signed-in uploads into an album are not public uploads
		if (target.type === 'album' || !isMailerConfigured()) return;

		const isPublicLinkUpload = target.type === 'link';
		// Dashboard uploads only notify when nobody is signed in
		if (!isPublicLinkUpload && (Boolean(uploader) || !SETTINGS.anonymousUploadNotificationsEnabled)) return;

		const context = isPublicLinkUpload
			? await albumNotificationContext(target.albumId)
			: await anonymousNotificationContext();
		if (!context) return;

		const recipients = [
			...new Set(
				context.users.flatMap(user =>
					user?.enabled && isValidEmail(user.username) && user.username !== uploader ? [user.username] : []
				)
			)
		];
		if (!recipients.length) return;

		const albumUrl =
			context.album === null
				? undefined
				: buildInstanceLink(`/dashboard/albums/${context.album.uuid}`, origin) || undefined;

		const results = await Promise.allSettled(
			recipients.map(async username =>
				sendUploadNotificationMail({
					albumName: context.album?.name,
					albumUrl,
					fileName: file.original,
					fileSize: Number(file.size),
					fileType: file.type,
					fileUrl: links.url,
					kind: isPublicLinkUpload ? 'album' : 'anonymous',
					previewUrl: links.preview,
					to: username
				})
			)
		);

		const failed = results.filter(result => result.status === 'rejected' || !result.value.sent).length;
		if (failed) log.warn(`Could not send ${failed} of the ${recipients.length} upload notifications`);
		else log.debug(`Sent ${recipients.length} upload notification(s)`);
	} catch (error) {
		logError(log, 'Could not send the upload notifications', error);
	}
};
