import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Zip from 'adm-zip';
import { uploadPath, watchPath } from '@/utils/File.js';
import { fetchNetworkStorageFile } from '@/utils/NetworkStorage.js';

export type ZipFile = {
	readonly isS3: boolean;
	readonly isWatched: boolean;
	readonly name: string;
	readonly original: string;
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
	return sanitized || 'files';
};

const readFileData = async (file: ZipFile) => {
	if (file.isS3) {
		const response = await fetchNetworkStorageFile(file.name);
		if (!response.ok) throw new Error(`Could not fetch file ${file.name} from network storage`);
		return Buffer.from(await response.arrayBuffer());
	}

	return readFile(path.join(file.isWatched ? watchPath : uploadPath, file.name));
};

export const createZipFromFiles = async (files: ZipFile[]) => {
	const zip = new Zip();
	const usedNames = new Set<string>();

	for (const file of files) {
		const data = await readFileData(file);
		zip.addFile(buildEntryName(sanitizeEntryName(file.original || file.name), usedNames), data);
	}

	return zip.toBuffer();
};

export const getZipContentDisposition = (name: string) => {
	const downloadName = `${getSafeDownloadName(name)}.zip`;

	return `attachment; filename="${downloadName.replaceAll(/[^\u0020-\u007E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
};
