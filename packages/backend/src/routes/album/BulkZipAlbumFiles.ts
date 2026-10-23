import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { logError } from '@/utils/Logger.js';
import { createZipFromFiles, getZipContentDisposition } from '@/utils/Zip.js';

export const schema = {
	summary: 'Download album files as ZIP',
	description: 'Creates on the fly a ZIP archive with the selected files of an album.',
	tags: ['Albums', 'Files', 'Bulk'],
	params: z
		.object({
			uuid: z.string().describe('The uuid of the album.')
		})
		.required(),
	body: z.object({
		files: z.array(z.string()).min(1).describe('The uuids of the files to include in the archive.')
	}),
	response: {
		200: z.any().describe('The ZIP archive as a download.'),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/album/:uuid/zip',
	method: 'post',
	middlewares: ['apiKey', 'auth']
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const { uuid } = req.params as { uuid: string };
	const { files } = req.body as z.infer<typeof schema.body>;

	const uniqueFiles = [...new Set(files)];
	if (!uniqueFiles.length) {
		void res.badRequest('No file uuids provided');
		return;
	}

	const album = await prisma.albums.findFirst({
		where: {
			uuid,
			userId: req.user.id
		},
		select: {
			name: true,
			files: {
				where: {
					uuid: {
						in: uniqueFiles
					}
				},
				select: {
					name: true,
					original: true,
					isS3: true,
					isWatched: true
				}
			}
		}
	});

	if (!album) {
		void res.notFound('The album could not be found');
		return;
	}

	if (album.files.length !== uniqueFiles.length) {
		void res.badRequest('Some of the selected files do not belong to this album');
		return;
	}

	try {
		const buffer = await createZipFromFiles(album.files);

		return res
			.header('content-type', 'application/zip')
			.header('content-disposition', getZipContentDisposition(album.name))
			.send(buffer);
	} catch (error) {
		logError(req.log, 'Could not create a zip with the selected album files', error);
		void res.internalServerError('There was a problem creating the ZIP archive');
	}
};
