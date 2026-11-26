import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { queryLimitSchema } from '@/structures/schemas/QueryLimit.js';
import { queryPageSchema } from '@/structures/schemas/QueryPage.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';
import { SETTINGS } from '@/structures/settings.js';
import { constructFilePublicLink } from '@/utils/File.js';
import { parseSortOrder, resolveSortOrder } from '@/utils/SortOrder.js';
import { resolveViewMode } from '@/utils/ViewMode.js';

export const schema = {
	summary: 'Get public album',
	description: 'Gets a public album link with its contents',
	tags: ['Albums'],
	params: z
		.object({
			identifier: z.string().describe('The identifier of the link used to access the album.')
		})
		.required(),
	query: z.object({
		page: queryPageSchema,
		limit: queryLimitSchema
	}),
	response: {
		200: z.object({
			message: responseMessageSchema,
			album: z.object({
				name: z.string().describe('The name of the album.'),
				description: z.string().nullable().describe('The description of the album.'),
				isNsfw: z.boolean().describe('Whether or not the album is NSFW.'),
				viewMode: z.enum(['list', 'thumbs']).describe('The view mode of the link.'),
				allowUploads: z.boolean().describe('Whether visitors can upload files through this link.'),
				hideFiles: z
					.boolean()
					.describe('Whether the album contents are hidden and only the visitor uploads are shown.'),
				count: z.number().describe('The amount of files in the album.'),
				files: z.array(
					z.object({
						name: z.string().describe('The name of the file.'),
						original: z.string().describe('The original name of the file.'),
						type: z.string().describe('The type of the file.'),
						size: z.coerce.number().describe('The size of the file in bytes.'),
						createdAt: z.date().describe('The date the file was uploaded.'),
						url: z.string().describe('The URL of the file.'),
						thumb: z.string().describe('The URL of the thumbnail of the file.'),
						preview: z.string().describe('The URL of the preview of the file.'),
						uuid: z.string().describe('The UUID of the file.')
					})
				),
				cover: z.string().nullable().describe('The URL of the cover of the album.')
			})
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/album/:identifier/view',
	method: 'get'
};

export const run = async (req: FastifyRequest, res: FastifyReply) => {
	const { identifier } = req.params as { identifier: string };

	// Set up pagination options
	const { page = 1, limit = 50 } = req.query as { limit?: number; page?: number };
	const options = {
		take: limit,
		skip: (page - 1) * limit
	};

	const link = await prisma.links.findFirst({
		where: {
			identifier,
			enabled: true
		},
		select: {
			albumId: true,
			allowUploads: true,
			hideFiles: true,
			viewMode: true,
			expiresAt: true
		}
	});

	if (!link) {
		void res.notFound("The link is disabled or it doesn't exist");
		return;
	}

	if (link.expiresAt && link.expiresAt < new Date()) {
		void res.notFound('The link has expired');
		return;
	}

	// First get the album's sortOrder
	const albumMeta = await prisma.albums.findFirst({
		where: {
			id: link.albumId
		},
		select: {
			sortOrder: true,
			viewMode: true
		}
	});

	// Determine sort order: album-specific > global default > legacy fallback
	const effectiveSortOrder = resolveSortOrder(albumMeta?.sortOrder, SETTINGS.defaultSortOrder);
	const orderBy = parseSortOrder(effectiveSortOrder);
	const viewMode = resolveViewMode(link.viewMode, albumMeta?.viewMode);

	/*
		Drop-only links keep the album contents private. Files are matched by IP
		and the absence of an owner, so a visitor only sees the files they uploaded
		themselves through this link. Server-side renders do not send the hint
		header and therefore always get an empty list: the server's IP says nothing
		about the visitor.
	*/
	const wantsOwnFiles = link.hideFiles && req.headers['x-album-visitor'] === '1';
	const fileWhere = link.hideFiles ? (wantsOwnFiles ? { userId: null, ip: req.ip } : { id: -1 }) : {};

	// Make sure the uuid exists and it belongs to the user
	const album = await prisma.albums.findFirst({
		where: {
			id: link.albumId
		},
		select: {
			name: true,
			description: true,
			nsfw: true,
			files: {
				where: fileWhere,
				select: {
					createdAt: true,
					name: true,
					original: true,
					size: true,
					type: true,
					isS3: true,
					isWatched: true,
					uuid: true
				},
				orderBy,
				...options
			},
			_count: {
				select: {
					files: {
						where: fileWhere
					}
				}
			}
		}
	});

	if (!album) {
		void res.notFound('The album could not be found');
		return;
	}

	const firstImage = await prisma.albums.findFirst({
		where: {
			id: link.albumId
		},
		select: {
			files: {
				where: fileWhere,
				select: {
					name: true
				},
				take: 1,
				orderBy
			}
		}
	});

	// Construct the public links
	const files = [];
	for (const file of album.files) {
		const { isWatched, isS3, ...modifiedFile } = file;
		files.push({
			...modifiedFile,
			...constructFilePublicLink({ req, fileName: modifiedFile.name, isS3, isWatched })
		});
	}

	const coverPublicLink = firstImage?.files[0]?.name
		? constructFilePublicLink({
				req,
				fileName: firstImage.files[0].name
			})
		: null;

	return res.send({
		message: 'Successfully retrieved album',
		album: {
			name: album.name,
			description: album.description,
			files,
			// Only send cover if the first file is an image
			cover: coverPublicLink?.thumb ? coverPublicLink.url : null,
			isNsfw: album.nsfw,
			viewMode,
			allowUploads: Boolean(link.allowUploads && SETTINGS.anonymousUploadsEnabled),
			hideFiles: link.hideFiles,
			count: album._count.files
		}
	});
};
