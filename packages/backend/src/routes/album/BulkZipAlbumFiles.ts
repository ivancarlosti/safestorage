import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Zip from 'adm-zip';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { uploadPath, watchPath } from '@/utils/File.js';
import { logError } from '@/utils/Logger.js';
import { fetchNetworkStorageFile } from '@/utils/NetworkStorage.js';

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

const sanitizeEntryName = (name: string) => {
	const baseName = path
		.basename(name)
		.replaceAll(/\p{Cc}/gu, '')
		.trim();
	if (!baseName || baseName === '.' || baseName === '..') return 'file';
	return baseName;
};

const buildEntryName = (original: string, used: Set<string>) => {
	const extension = path.extname(original);
	const baseName = path.basename(original, extension);

	let candidate = original;
	let counter = 1;
	while (used.has(candidate)) {
		candidate = `${baseName} (${counter})${extension}`;
		counter++;
	}

	used.add(candidate);
	return candidate;
};

const getSafeDownloadName = (name: string) => {
	const sanitized = name
		.replaceAll(/[^\u0020-\u007E]/g, '_')
		.replaceAll(/["\\]/g, '_')
		.trim();
	return sanitized || 'album';
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
		const zip = new Zip();
		const usedNames = new Set<string>();

		for (const file of album.files) {
			let data: Buffer;

			if (file.isS3) {
				const response = await fetchNetworkStorageFile(file.name);
				if (!response.ok) throw new Error(`Could not fetch file ${file.name} from network storage`);
				data = Buffer.from(await response.arrayBuffer());
			} else {
				data = await readFile(path.join(file.isWatched ? watchPath : uploadPath, file.name));
			}

			const entryName = buildEntryName(sanitizeEntryName(file.original || file.name), usedNames);
			zip.addFile(entryName, data);
		}

		const downloadName = `${getSafeDownloadName(album.name)}.zip`;
		const encodedName = encodeURIComponent(downloadName);

		return res
			.header('content-type', 'application/zip')
			.header(
				'content-disposition',
				`attachment; filename="${downloadName.replaceAll(/[^\u0020-\u007E]/g, '_')}"; filename*=UTF-8''${encodedName}`
			)
			.send(zip.toBuffer());
	} catch (error) {
		logError(req.log, 'Could not create a zip with the selected album files', error);
		void res.internalServerError('There was a problem creating the ZIP archive');
	}
};
