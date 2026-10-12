import { basename, extname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import type { FSWatcher } from 'chokidar';
import { watch } from 'chokidar';
import { fileTypeFromFile } from 'file-type';
import { checkFileNameOnDB, hashFile, storeFileToDb, updateFileOnDb } from './File.js';
import { generateThumbnails } from './Thumbnails.js';

let chokidar: FSWatcher | undefined;

export const getFileWatcher = () => {
	if (chokidar) {
		return chokidar;
	}

	chokidar = watch(fileURLToPath(new URL('../../../../uploads/live', import.meta.url)), {
		ignoreInitial: true,
		persistent: true,
		alwaysStat: true
	});

	return chokidar;
};

export const fileWatcher = () => {
	const watcher = getFileWatcher();

	watcher.on('add', async (path, stats) => {
		const name = basename(path);
		const mimeType = await fileTypeFromFile(path);
		const hash = await hashFile(path);

		const file = {
			name,
			// @ts-ignore
			extension: extname(path),
			path,
			// @ts-ignore
			original: name,
			// @ts-ignore
			type: mimeType?.mime ?? 'application/octet-stream',
			// @ts-ignore
			size: String(stats?.size ?? 0),
			hash,
			// @ts-ignore
			ip: '127.0.0.1',
			isS3: false,
			isWatched: true
		};

		const fileOnDb = await checkFileNameOnDB({ id: 1 } as any, name);
		if (fileOnDb?.repeated) {
			const updatedFile = await updateFileOnDb({ id: 1 } as any, { ...file, uuid: fileOnDb.file.uuid });
			void generateThumbnails({ filename: updatedFile.name, watched: true });
		} else {
			const savedFile = await storeFileToDb({ id: 1 } as any, file);
			void generateThumbnails({ filename: savedFile.file.name, watched: true });
		}
	});
};
