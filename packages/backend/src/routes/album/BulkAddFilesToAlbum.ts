import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';
import { getAlbumAccess } from '@/utils/AlbumAccess.js';
import { logError } from '@/utils/Logger.js';

export const schema = {
	summary: 'Add files to album',
	description: 'Adds all the supplied files to an album',
	tags: ['Files', 'Albums', 'Bulk'],
	body: z.array(
		z.object({
			album: z.string().describe('The uuid of the album.'),
			files: z.array(z.string()).describe('The uuids of the files.')
		})
	),
	response: {
		200: z.object({
			message: responseMessageSchema
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/files/album/add',
	method: 'post',
	middlewares: ['apiKey', 'auth']
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const data = req.body as z.infer<typeof schema.body>;

	if (!data?.length) {
		void res.badRequest('No data provided');
		return;
	}

	const now = new Date();
	// Prisma doesn't support updating relations in bulk :D
	// https://github.com/prisma/prisma/issues/3143
	//
	// await prisma.files.updateMany({
	// 	where: {
	// 		uuid: {
	// 			in: files
	// 		}
	// 	},
	// 	data: {
	// 		albums: {
	// 			connect: {
	// 				uuid: albumUuid
	// 			}
	// 		}
	// 	}
	// });

	try {
		// Albums can be shared, so the access check happens once per album instead of on every file.
		const albumIds = new Map<string, number>();

		for (const { album, files } of data) {
			let albumId = albumIds.get(album);

			if (!albumId) {
				const access = await getAlbumAccess(req.user.id, album);
				if (!access) {
					void res.notFound("One of the albums doesn't exist or the user has no access to it");
					return;
				}

				albumId = access.id;
				albumIds.set(album, albumId);
			}

			/*
				Only the files uploaded by the caller can be put in an album. Members of
				a shared album see the files of the owner, so the check happens up front
				instead of letting the update blow up with a 500.
			*/
			const uniqueFiles = [...new Set(files)];
			const ownedFiles = await prisma.files.findMany({
				where: {
					uuid: {
						in: uniqueFiles
					},
					userId: req.user.id
				},
				select: {
					uuid: true
				}
			});

			if (ownedFiles.length !== uniqueFiles.length) {
				void res.badRequest('You can only add files you uploaded to an album');
				return;
			}

			for (const file of uniqueFiles) {
				await prisma.files.update({
					where: {
						uuid: file,
						userId: req.user.id
					},
					data: {
						albums: {
							connect: {
								id: albumId
							}
						}
					}
				});
			}

			await prisma.albums.update({
				where: {
					id: albumId
				},
				data: {
					editedAt: now
				}
			});
		}
	} catch (error: any) {
		logError(req.log, 'Failed to add the files to the album', error);
		void res.internalServerError('Failed to add files to album');
		return;
	}

	return res.send({
		message: 'Successfully added files to album'
	});
};
