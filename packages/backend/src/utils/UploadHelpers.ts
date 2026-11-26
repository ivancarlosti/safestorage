import JWT from 'jsonwebtoken';
import prisma from '@/structures/database.js';
import type { RequestUser } from '@/structures/interfaces.js';
import { SETTINGS } from '@/structures/settings.js';
import { albumAccessWhere } from '@/utils/AlbumAccess.js';
import { ensureAlbumIdentifier } from '@/utils/Util.js';

export const authUser = async (authorization?: string | null) => {
	if (!authorization) return null;

	const token = authorization.split(' ')[1];
	if (!token) throw new Error('Malformed authorization header');

	let id;
	let dateSigned;

	try {
		const decoded = JWT.verify(token, SETTINGS.secret ?? '');
		id = decoded.sub ?? null;
		// @ts-ignore
		dateSigned = decoded.iat ?? null;
		if (!id) throw new Error('Invalid authorization');
	} catch {
		throw new Error('Invalid token');
	}

	const user = await prisma.users.findFirst({
		where: {
			id: id as unknown as number
		},
		select: {
			id: true,
			uuid: true,
			username: true,
			roles: {
				select: {
					name: true
				}
			},
			apiKey: true,
			passwordEditedAt: true
		}
	});

	if (dateSigned && Number(user?.passwordEditedAt) > dateSigned) {
		throw new Error('Expired token');
	}

	if (!user) throw new Error("User doesn't exist");
	return {
		id: user.id,
		uuid: user.uuid,
		username: user.username,
		roles: user.roles,
		apiKey: user.apiKey
	} as RequestUser;
};

/*
	The album an upload lands in. `identifier` is the folder of a website album
	(`site/{identifier}/`), generated on demand for albums that predate it.
*/
export interface UploadAlbum {
	id: number;
	identifier: string | null;
	isWebsite: boolean;
}

export type UploadTarget =
	| { album: null; type: 'none' }
	| { album: UploadAlbum; type: 'album' }
	| { album: UploadAlbum; linkUuid: string; type: 'link' };

/*
	Website albums own a folder, gallery albums do not. The identifier is
	allocated here (instead of only when the album is created) because an album
	created before the folder layout existed has none yet.
*/
const toUploadAlbum = async (album: UploadAlbum | null): Promise<UploadAlbum | null> => {
	if (!album) return null;
	return { ...album, identifier: await ensureAlbumIdentifier(album) };
};

/*
	Browsers report an empty `type` for formats they cannot name (an `.iso`
	image, for instance). An empty value is not a usable MIME type: it becomes
	the object's Content-Type on the multipart path and the database row that
	`UploadProcess` writes. Every upload path uses this fallback so the stored
	metadata and the database always agree.
*/
export const normalizeContentType = (contentType?: string | null) => contentType || 'application/octet-stream';

export type UploadTargetValidation = { error: string; status: number } | { target: UploadTarget };

/*
	Works out where an upload should go and whether the caller is allowed to send
	it. Public links can accept uploads even when the instance is not in public
	mode, while guests uploading without a link still need public mode. Both are
	disabled together by the anonymous uploads master switch.
*/
export const validateUploadTarget = async ({
	albumUuid,
	linkIdentifier,
	user
}: {
	albumUuid?: string | null;
	linkIdentifier?: string | null;
	user?: RequestUser | undefined;
}): Promise<UploadTargetValidation> => {
	if (linkIdentifier) {
		const link = await prisma.links.findFirst({
			where: {
				identifier: linkIdentifier,
				enabled: true
			},
			select: {
				albumId: true,
				allowUploads: true,
				expiresAt: true,
				uuid: true
			}
		});

		if (!link) return { error: "The link is disabled or it doesn't exist", status: 404 };
		if (link.expiresAt && link.expiresAt < new Date()) return { error: 'The link has expired', status: 404 };
		if (!link.allowUploads) return { error: 'This link does not allow uploads', status: 403 };
		if (!SETTINGS.anonymousUploadsEnabled) return { error: 'Anonymous uploads are disabled', status: 403 };

		const album = await prisma.albums.findFirst({
			where: {
				id: link.albumId
			},
			select: {
				id: true,
				identifier: true,
				isWebsite: true
			}
		});

		if (!album) return { error: "The album of this link doesn't exist anymore", status: 404 };

		const uploadAlbum = await toUploadAlbum(album);
		if (!uploadAlbum) return { error: "The album of this link doesn't exist anymore", status: 404 };

		return { target: { album: uploadAlbum, linkUuid: link.uuid, type: 'link' } };
	}

	if (!albumUuid) {
		if (!user) {
			if (!SETTINGS.anonymousUploadsEnabled) return { error: 'Anonymous uploads are disabled', status: 403 };
			if (!SETTINGS.publicMode) {
				return { error: 'Only registered users are allowed to upload files.', status: 401 };
			}
		}

		return { target: { album: null, type: 'none' } };
	}

	if (!user) return { error: 'Only registered users can upload files to an album.', status: 401 };

	const album = await prisma.albums.findFirst({
		where: albumAccessWhere(user.id, albumUuid),
		select: {
			id: true,
			identifier: true,
			isWebsite: true
		}
	});

	if (!album) return { error: "Album doesn't exist or the user has no access to it.", status: 400 };

	const uploadAlbum = await toUploadAlbum(album);
	if (!uploadAlbum) return { error: "Album doesn't exist or the user has no access to it.", status: 400 };

	return { target: { album: uploadAlbum, type: 'album' } };
};
