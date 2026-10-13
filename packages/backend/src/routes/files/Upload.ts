import { basename, extname } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { CreateMultipartUploadCommand, PutObjectCommand, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { processFile } from '@safestorage/uploader-module';
import slugify from '@sindresorhus/slugify';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { SETTINGS } from '@/structures/settings.js';
import { getUniqueFileIdentifier, constructFilePublicLink, deleteTmpFile, handleUploadFile } from '@/utils/File.js';
import { validateAlbum } from '@/utils/UploadHelpers.js';
import { getUsedQuota } from '@/utils/User.js';

/*
	Files bigger than this are uploaded with a S3 multipart upload instead of a
	single pre-signed PUT request: a single PUT caps at 5 GB, cannot be resumed,
	and its pre-signed URL expires while a big file is still in flight.
*/
const multipartThreshold = 100 * 1024 * 1024; // 100 MiB
const minimumPartSize = 5 * 1024 * 1024; // 5 MiB, the smallest part S3 accepts
const maximumPartSize = 5 * 1024 * 1024 * 1024; // 5 GiB, the biggest part S3 accepts
const maximumParts = 1000; // S3 allows 10000 parts, staying below keeps the response small
const uploadUrlExpiration = 60 * 60 * 12; // 12 hours, big uploads take a long time

export const schema = {
	summary: 'Upload file',
	description: 'Uploads a file',
	tags: ['Files'],
	headers: z.object({
		albumuuid: z.string().optional().describe('The uuid of the album.'),
		'safestorage-chunk-number': z.coerce.number().optional().describe('The chunk number.'),
		'safestorage-chunks-total': z.coerce.number().optional().describe('The total number of chunks.'),
		'safestorage-uuid': z.string().optional().describe('The uuid of the file.'),
		'x-source-url': z.string().optional().describe('The source URL of the file.')
	}),
	body: z
		.object({
			size: z.number().describe('The size of the file.'),
			name: z.string().describe('The name of the file.'),
			contentType: z.string().describe('The content type of the file.'),
			sourceUrl: z.string().optional().describe('The source URL of the file.')
		})
		.or(z.null()),
	response: {
		200: z.object({
			name: z.string().optional().describe('The name of the file.'),
			uuid: z.string().optional().describe('The uuid of the file.'),
			url: z
				.string()
				.optional()
				.describe('The URL of the file, or the pre-signed URL to upload it to when using network storage.'),
			identifier: z.string().optional().describe('The identifier of the file on the network storage.'),
			publicUrl: z.string().optional().describe('The public URL of the file.'),
			multipart: z
				.object({
					uploadId: z.string().describe('The id of the S3 multipart upload.'),
					partSize: z.number().describe('The size in bytes each part of the upload must have.'),
					parts: z
						.array(
							z.object({
								partNumber: z.number().describe('The number of the part.'),
								url: z.string().describe('The pre-signed URL to upload this part to.')
							})
						)
						.describe('The pre-signed URLs to upload every part of the file to.')
				})
				.optional()
				.describe('Only present when the file has to be uploaded with a S3 multipart upload.')
		}),
		204: z.null(),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/upload',
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

export const uploadToNetworkStorage = async (req: RequestWithUser, res: FastifyReply) => {
	/*
		With the network storage enabled every upload is a JSON request describing
		the file, because the bytes go straight from the browser to the bucket.
		A multipart body here (e.g. the setting was just switched on while a chunked
		upload was in flight) is answered with a clear error instead of a crash.
	*/
	const { contentType, size, name } = (req.body ?? {}) as {
		contentType?: string;
		name?: string;
		size?: number;
	};
	if (!contentType || !size || !name) {
		void res.badRequest('Missing file information');
		return;
	}

	const quota = await getUsedQuota(req.user?.id as number);
	if (quota?.overQuota) {
		void res.forbidden('You are over your storage quota');
		return;
	}

	if (!SETTINGS.publicMode && !req.user) {
		void res.unauthorized('Only registered users are allowed to upload files.');
		return;
	}

	const fileExtension = `.${name.split('.').pop()!}`.toLowerCase();
	if (SETTINGS.blockedExtensions.includes(fileExtension)) {
		void res.badRequest('File type is not allowed.');
		return;
	}

	// Assign a unique identifier to the file
	const uniqueIdentifier = await getUniqueFileIdentifier();
	if (!uniqueIdentifier) throw new Error('Could not generate unique identifier.');

	const ext = extname(name);
	let newFilename = `${uniqueIdentifier}${ext}`;
	if (SETTINGS.generateOriginalFileNameWithIdentifier) {
		const isLowerCase = !SETTINGS.enableMixedCaseFilenames || process.platform === 'win32';
		const originalNameWithoutExt = basename(name, ext);
		newFilename = `${slugify(originalNameWithoutExt, { separator: '_', lowercase: isLowerCase })}-${uniqueIdentifier}${ext}`;
	}

	if (size > SETTINGS.maxSize) {
		void res.payloadTooLarge('File is too big');
		return;
	}

	const publicUrl = `${SETTINGS.S3PublicUrl || SETTINGS.S3Endpoint}/${newFilename}`;

	try {
		const { createS3Client } = await import('@/structures/s3.js');
		const S3Client = createS3Client();

		// Small files are uploaded with a single pre-signed PUT request.
		if (size <= multipartThreshold) {
			const url = await getSignedUrl(
				S3Client,
				new PutObjectCommand({
					Bucket: SETTINGS.S3Bucket,
					Key: newFilename,
					ContentType: contentType,
					ContentLength: size
				}),
				{ expiresIn: 3600 }
			);

			await res.code(200).send({
				url,
				identifier: newFilename,
				publicUrl
			});

			return;
		}

		/*
			Bigger files are uploaded in parts, in parallel. The part size is picked
			so that the file needs at most `maximumParts` parts while every part
			stays inside the 5 MiB - 5 GiB window S3 allows.
		*/
		const partSize = Math.min(maximumPartSize, Math.max(minimumPartSize, Math.ceil(size / maximumParts)));
		const partsAmount = Math.ceil(size / partSize);
		if (partsAmount > maximumParts) {
			void res.payloadTooLarge('File is too big to be uploaded to the network storage');
			return;
		}

		const { UploadId } = await S3Client.send(
			new CreateMultipartUploadCommand({
				Bucket: SETTINGS.S3Bucket,
				Key: newFilename,
				ContentType: contentType
			})
		);

		if (!UploadId) {
			void res.internalServerError('Could not create the multipart upload');
			return;
		}

		const parts = await Promise.all(
			Array.from({ length: partsAmount }, async (_, index) => {
				const partNumber = index + 1;
				const url = await getSignedUrl(
					S3Client,
					new UploadPartCommand({
						Bucket: SETTINGS.S3Bucket,
						Key: newFilename,
						UploadId,
						PartNumber: partNumber
					}),
					{ expiresIn: uploadUrlExpiration }
				);

				return { partNumber, url };
			})
		);

		await res.code(200).send({
			identifier: newFilename,
			publicUrl,
			multipart: {
				uploadId: UploadId,
				partSize,
				parts
			}
		});
	} catch (error) {
		req.log.error(error);
		void res.internalServerError('Could not generate signed URL');
	}
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	if (SETTINGS.useNetworkStorage) return uploadToNetworkStorage(req, res);

	const tmpDir = fileURLToPath(new URL('../../../../../uploads/tmp', import.meta.url));
	const maxChunkSize = SETTINGS.chunkSize;
	/*
		`@safestorage/uploader-module` rejects a chunked upload when
		`maxChunkSize * totalChunks` is bigger than the file size it is given, and
		the browser rounds `totalChunks` up, so that product can overshoot the real
		file size by up to one chunk. Allow for that rounding here (and enforce the
		real limit against the size the browser declared further down), otherwise
		every file that is close to `maxSize` is rejected with a 413.
	*/
	const maxFileSize = SETTINGS.maxSize + SETTINGS.chunkSize;

	const quota = await getUsedQuota(req.user?.id as number);
	if (quota?.overQuota) {
		void res.forbidden('You are over your storage quota');
		return;
	}

	try {
		if (!SETTINGS.publicMode && !req.user) {
			void res.unauthorized('Only registered users are allowed to upload files.');
			return;
		}

		const upload = await processFile(req.raw, {
			destination: tmpDir,
			maxFileSize,
			maxChunkSize,
			debug: process.env.NODE_ENV !== 'production'
		});

		if (upload.isChunkedUpload && !upload.ready) {
			return await res.code(204).send();
		}

		/*
			`maxFileSize` had to be widened above to tolerate the chunk rounding, so
			enforce the real limit against the total size of the file, which the
			browser sends along with the last chunk.
		*/
		const declaredSize = Number(upload.metadata.size);
		if (Number.isFinite(declaredSize) && declaredSize > SETTINGS.maxSize) {
			await deleteTmpFile(upload.path as string);
			void res.payloadTooLarge('File is too big');
			return;
		}

		if (!upload.metadata.name) {
			await deleteTmpFile(upload.path as string);
			void res.badRequest('Missing file name.');
			return;
		}

		const fileExtension = `.${upload.metadata.name.split('.').pop()!}`.toLowerCase();
		if (SETTINGS.blockedExtensions.includes(fileExtension)) {
			await deleteTmpFile(upload.path as string);
			void res.badRequest('File type is not allowed.');
			return;
		}

		// Check if the new uploaded file sends the user over the quota
		const quotaAfterUpload = await getUsedQuota(req.user?.id as number, Number(upload.metadata.size));
		if (quotaAfterUpload?.overQuota) {
			await deleteTmpFile(upload.path as string);
			void res.forbidden('You are over your storage quota');
			return;
		}

		const album = await validateAlbum(req.headers.albumuuid as string, req.user ? req.user : undefined);

		const uploadedFile = await handleUploadFile({
			user: req.user,
			ip: req.ip,
			upload: {
				name: upload.metadata.name,
				path: upload.path as string,
				type: upload.metadata.type as string,
				size: upload.metadata.size ?? '0',
				sourceUrl: (req.headers['x-source-url'] as string) ?? undefined
			},
			album
		});

		const linkData = constructFilePublicLink({ req, fileName: uploadedFile.name });
		// Construct public link
		const fileWithLink = {
			...uploadedFile,
			...linkData
		};

		await res.code(200).send(fileWithLink);
	} catch (error: any) {
		switch (error.message) {
			case 'Chunked upload is above size limit':
			case 'Chunk is too big':
			case 'File is too big':
				void res.payloadTooLarge(error.message);
				break;
			case 'safestorage-uuid is not a string':
			case 'safestorage-uuid does not meet the length criteria':
			case 'safestorage-uuid is not a valid uuid':
			case 'Chunk is out of range':
			case 'Invalid headers':
				void res.badRequest(error.message);
				break;
		}

		res.log.error(error);
	}
};
