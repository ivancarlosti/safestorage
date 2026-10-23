import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { logError } from '@/utils/Logger.js';
import { createZipFromFiles, getZipContentDisposition } from '@/utils/Zip.js';

export const schema = {
	summary: 'Download files as ZIP',
	description: 'Creates on the fly a ZIP archive with the selected files of the logged in user.',
	tags: ['Files', 'Bulk'],
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
	url: '/files/zip',
	method: 'post',
	middlewares: ['apiKey', 'auth']
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const { files } = req.body as z.infer<typeof schema.body>;

	const uniqueFiles = [...new Set(files)];
	if (!uniqueFiles.length) {
		void res.badRequest('No file uuids provided');
		return;
	}

	const dbFiles = await prisma.files.findMany({
		where: {
			uuid: {
				in: uniqueFiles
			},
			userId: req.user.id,
			quarantine: false
		},
		select: {
			name: true,
			original: true,
			isS3: true,
			isWatched: true
		}
	});

	if (!dbFiles.length) {
		void res.notFound('The files could not be found');
		return;
	}

	if (dbFiles.length !== uniqueFiles.length) {
		void res.badRequest('Some of the selected files could not be found or are not available for download');
		return;
	}

	try {
		const buffer = await createZipFromFiles(dbFiles);

		return res
			.header('content-type', 'application/zip')
			.header('content-disposition', getZipContentDisposition('files'))
			.send(buffer);
	} catch (error) {
		logError(req.log, 'Could not create a zip with the selected files', error);
		void res.internalServerError('There was a problem creating the ZIP archive');
	}
};
