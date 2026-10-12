import { CompleteMultipartUploadCommand, ListPartsCommand } from '@aws-sdk/client-s3';
import type { ListPartsCommandInput } from '@aws-sdk/client-s3';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { SETTINGS } from '@/structures/settings.js';

export const schema = {
	summary: 'Complete multipart upload',
	description:
		'Completes a S3 multipart upload after every part has been uploaded. The uploaded parts are collected server-side, so the bucket does not need to expose the ETag header through CORS.',
	tags: ['Files'],
	/*
		No `.required()` on this object: it would also turn the optional `size`
		into a required field. `uploadId` and `key` are required because they are
		not `.optional()`.
	*/
	body: z.object({
		uploadId: z.string().describe('The id of the multipart upload returned by the upload endpoint.'),
		key: z.string().describe('The identifier of the file on the network storage.'),
		size: z.number().optional().describe('The size of the file, used to verify that all parts arrived.')
	}),
	response: {
		200: z.object({
			identifier: z.string().describe('The identifier of the file on the network storage.')
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/upload/multipart/complete',
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

	const { uploadId, key, size } = req.body as { key: string; size?: number; uploadId: string };
	if (!uploadId || !key) return res.badRequest('Missing multipart upload information');

	if (!SETTINGS.publicMode && !req.user) {
		void res.unauthorized('Only registered users are allowed to upload files.');
		return;
	}

	try {
		const { createS3Client } = await import('@/structures/s3.js');
		const S3Client = createS3Client();

		/*
			The browser is not asked to remember the ETag of every part (that would
			require `ExposeHeaders: ETag` in the bucket CORS rules), so the parts are
			listed here instead.
		*/
		const parts: { ETag: string; PartNumber: number; Size: number | undefined }[] = [];
		let partNumberMarker: string | undefined;
		for (;;) {
			const params: ListPartsCommandInput = {
				Bucket: SETTINGS.S3Bucket,
				Key: key,
				UploadId: uploadId
			};

			// Only sent while there are more pages of parts to list
			if (partNumberMarker) params.PartNumberMarker = partNumberMarker;

			const listing = await S3Client.send(new ListPartsCommand(params));

			for (const part of listing.Parts ?? []) {
				if (!part.ETag || !part.PartNumber) continue;
				parts.push({ ETag: part.ETag, PartNumber: part.PartNumber, Size: part.Size });
			}

			if (!listing.IsTruncated) break;
			partNumberMarker = listing.NextPartNumberMarker;
		}

		if (!parts.length) {
			void res.badRequest('No parts were uploaded for this multipart upload');
			return;
		}

		/*
			Completing a multipart upload with a missing part would silently store a
			truncated file, so make sure everything arrived before committing it.
		*/
		if (size && parts.every(part => typeof part.Size === 'number')) {
			const uploadedSize = parts.reduce((total, part) => total + (part.Size ?? 0), 0);
			if (uploadedSize !== size) {
				void res.badRequest('Not all parts of the file were uploaded, please try again');
				return;
			}
		}

		await S3Client.send(
			new CompleteMultipartUploadCommand({
				Bucket: SETTINGS.S3Bucket,
				Key: key,
				UploadId: uploadId,
				MultipartUpload: {
					Parts: parts.map(part => ({ ETag: part.ETag, PartNumber: part.PartNumber }))
				}
			})
		);

		await res.code(200).send({ identifier: key });
	} catch (error: any) {
		req.log.error(error);

		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		if (error?.name === 'NoSuchUpload') {
			void res.badRequest('The multipart upload does not exist (it may have expired or been aborted)');
			return;
		}

		void res.internalServerError('Could not complete the multipart upload');
	}
};
