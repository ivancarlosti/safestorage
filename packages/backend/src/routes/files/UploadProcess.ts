import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { SETTINGS } from '@/structures/settings.js';
import { storeFileToDb, constructFilePublicLink, checkFileHashOnDB, deleteTmpFile } from '@/utils/File.js';
import { logError } from '@/utils/Logger.js';
import { fetchNetworkStorageFile, getNetworkStorageTmpPath, isValidFileIdentifier } from '@/utils/NetworkStorage.js';
import { generateThumbnails, imageExtensions, videoExtensions } from '@/utils/Thumbnails.js';
import { validateAlbum } from '@/utils/UploadHelpers.js';

export const schema = {
	summary: 'Process uploaded file',
	description: 'Processes an uploaded file',
	tags: ['Files'],
	headers: z.object({
		albumuuid: z.string().optional().describe('The uuid of the album.')
	}),
	/*
		No `.required()` on this object: it would also turn the optional
		`sourceUrl` into a required field, and the frontend only sends it for
		files that come from a URL. `identifier`, `name` and `type` stay required
		because they are not `.optional()`.
	*/
	body: z.object({
		identifier: z.string().describe('The identifier of the file.'),
		name: z.string().describe('The name of the file.'),
		type: z.string().describe('The type of the file.'),
		sourceUrl: z.string().optional().describe('The source URL of the file.')
	}),
	response: {
		200: z.object({
			name: z.string().describe('The name of the file.'),
			uuid: z.string().describe('The uuid of the file.'),
			url: z.string().describe('The URL of the file.')
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/upload/process',
	method: 'post',
	middlewares: [
		{
			name: 'apiKey'
		},
		{
			name: 'auth',
			optional: true
		}
	]
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	if (!SETTINGS.useNetworkStorage) return res.internalServerError('Network storage is not enabled');

	const { identifier, name, type, sourceUrl } = req.body as {
		identifier: string;
		name: string;
		sourceUrl?: string;
		type: string;
	};
	if (!identifier || !name || !type) return res.badRequest('Missing file identifier');
	if (!isValidFileIdentifier(identifier)) return res.badRequest('Invalid file identifier');

	const { createS3Client } = await import('@/structures/s3.js');
	const S3Client = createS3Client();

	const album = await validateAlbum(req.headers.albumuuid as string, req.user ? req.user : undefined);

	const newPath = getNetworkStorageTmpPath(identifier);

	let fileSize = 0;
	let hash = '';

	try {
		const command = new HeadObjectCommand({
			Bucket: SETTINGS.S3Bucket,
			Key: identifier
		});

		const response = await S3Client.send(command);
		fileSize = response.ContentLength ?? 0;
		hash = response.ETag?.replace(/"/g, '') ?? '';
	} catch (error) {
		logError(req.log, 'Failed to fetch the file from the network storage', error);
		return res.internalServerError('Failed to fetch file');
	}

	const extension = path.extname(identifier);

	const file = {
		name: identifier,
		extension,
		path: newPath,
		original: name,
		type,
		size: String(fileSize),
		hash,
		ip: req.ip,
		isS3: true,
		isWatched: false,
		sourceUrl
	};

	let uploadedFile;
	const fileOnDb = await checkFileHashOnDB(req.user, file);
	if (fileOnDb?.repeated) {
		uploadedFile = fileOnDb.file;
		await deleteTmpFile(newPath);

		const command = new DeleteObjectCommand({
			Bucket: SETTINGS.S3Bucket,
			Key: identifier
		});

		await S3Client.send(command);
	} else {
		// Store file in database
		const savedFile = await storeFileToDb(req.user ? req.user : undefined, file, album ? album : undefined);

		uploadedFile = savedFile.file;

		// Generate thumbnails
		const needsThumbnails = [...imageExtensions, ...videoExtensions].includes(extension);
		const maxFileSizeForThumbnails = 100 * 1024 * 1024; // 100Mb

		if (needsThumbnails && fileSize <= maxFileSizeForThumbnails) {
			fetchNetworkStorageFile(identifier)
				// eslint-disable-next-line promise/prefer-await-to-then
				.then(async res => {
					if (!res.body) throw new Error('Failed to fetch file');

					// @ts-expect-error wrong types
					await finished(Readable.fromWeb(res.body).pipe(fs.createWriteStream(newPath)));
				})
				// eslint-disable-next-line promise/prefer-await-to-then
				.then(() => {
					void generateThumbnails({ filename: savedFile.file.name, tmp: true });
				})
				// eslint-disable-next-line promise/prefer-await-to-callbacks, promise/prefer-await-to-then
				.catch(error => {
					logError(req.log, 'Failed to store the uploaded file from the network storage', error);
					void deleteTmpFile(newPath);
				});
		}
	}

	const linkData = constructFilePublicLink({ req, fileName: uploadedFile.name, isS3: true });
	// Construct public link
	const fileWithLink = {
		...uploadedFile,
		...linkData
	};

	await res.code(200).send(fileWithLink);
};
