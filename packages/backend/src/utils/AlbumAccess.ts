import type { Prisma } from '@/generated/prisma/client.js';
import prisma from '@/structures/database.js';

/*
	Album sharing model.

	The owner of an album (albums.userId) can rename it, delete or purge it and
	manage its public links. Everyone listed in `albumMembers` gets the content:
	they see the album in their dashboard, can upload to it and can add or
	remove their own files from it.
*/

export const albumAccessWhere = (userId: number, uuid?: string): Prisma.albumsWhereInput => {
	const where: Prisma.albumsWhereInput = {
		OR: [{ userId }, { members: { some: { userId } } }]
	};

	if (uuid) where.uuid = uuid;
	return where;
};

export const albumOwnerWhere = (userId: number, uuid?: string): Prisma.albumsWhereInput => {
	const where: Prisma.albumsWhereInput = { userId };

	if (uuid) where.uuid = uuid;
	return where;
};

/*
	Every route in the album folder needs the same two answers: does the album
	exist for this user, and does this user own it.
*/
export const getAlbumAccess = async (userId: number, uuid: string) => {
	const album = await prisma.albums.findFirst({
		where: albumAccessWhere(userId, uuid),
		select: {
			id: true,
			name: true,
			userId: true
		}
	});

	if (!album) return null;

	return { id: album.id, isOwner: album.userId === userId, name: album.name };
};

/*
	Files stay owned by whoever uploaded them, so a member of a shared album can
	only see the files they uploaded plus the ones reachable through an album
	they are a member of.
*/
export const fileAccessWhere = (userId: number, uuid?: string): Prisma.filesWhereInput => {
	const where: Prisma.filesWhereInput = {
		OR: [{ userId }, { albums: { some: { members: { some: { userId } } } } }]
	};

	if (uuid) where.uuid = uuid;
	return where;
};

/*
	A file uploaded through a public album link has no uploader (files.userId is
	null), so it belongs to the owner of the album it was uploaded to. Files with an
	uploader stay tied to that user, which keeps members of a shared album from
	managing the files of others.
*/
export const fileOwnerWhere = (userId: number, uuid?: string): Prisma.filesWhereInput => {
	const where: Prisma.filesWhereInput = {
		OR: [{ userId }, { userId: null, albums: { some: { userId } } }]
	};

	if (uuid) where.uuid = uuid;
	return where;
};
