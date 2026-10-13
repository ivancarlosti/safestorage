import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';
import { deleteTmpFile } from '@/utils/File.js';
import { logError } from '@/utils/Logger.js';
import { fetchNetworkStorageFile, getNetworkStorageTmpPath } from '@/utils/NetworkStorage.js';
import { generateThumbnails, imageExtensions, videoExtensions } from '@/utils/Thumbnails.js';

export const schema = {
	summary: 'Regenerate thumbnail',
	description: 'Regenerates a broken file thumbnail',
	tags: ['Files'],
	params: z
		.object({
			uuid: z.string().describe('The uuid of the file.')
		})
		.required(),
	response: {
		200: z.object({
			message: responseMessageSchema
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/file/:uuid/thumbnail/regenerate',
	method: 'post',
	middlewares: ['apiKey', 'auth']
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const { uuid } = req.params as { uuid: string };

	// Make sure the file exists and belongs to the user
	const file = await prisma.files.findFirst({
		where: {
			uuid,
			userId: req.user.id
		},
		select: {
			name: true,
			isS3: true,
			isWatched: true,
			size: true
		}
	});

	if (!file) {
		void res.notFound('The file could not be found');
		return;
	}

	if (file.isS3) {
		const extension = path.extname(file.name);
		const needsThumbnails = [...imageExtensions, ...videoExtensions].includes(extension);
		const maxFileSizeForThumbnails = 100 * 1024 * 1024; // 100Mb

		if (needsThumbnails && Number.parseInt(file.size, 10) <= maxFileSizeForThumbnails) {
			const newPath = getNetworkStorageTmpPath(file.name);

			try {
				const fetchResponse = await fetchNetworkStorageFile(file.name);
				if (!fetchResponse.body) return await res.internalServerError('Failed to fetch file');

				// @ts-expect-error wrong types
				await finished(Readable.fromWeb(fetchResponse.body).pipe(fs.createWriteStream(newPath)));
			} catch (error) {
				logError(req.log, 'Failed to fetch the file to regenerate its thumbnail', error);
				void deleteTmpFile(newPath);
				return res.internalServerError('Failed to fetch file');
			}
		}
	}

	void generateThumbnails({ filename: file.name, tmp: file.isS3, watched: file.isWatched, force: true });

	return res.send({
		message: 'Successfully regenerated file thumbnail'
	});
};
