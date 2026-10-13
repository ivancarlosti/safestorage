import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import ffmpeg from 'fluent-ffmpeg';
import jetpack from 'fs-jetpack';
import { SETTINGS } from '@/structures/settings.js';
import { deleteTmpFile } from './File.js';
import { log, logError } from './Logger.js';
import previewUtil from './videoPreview/FragmentPreview.js';

export const imageExtensions = ['.jpg', '.jpeg', '.gif', '.png', '.webp', '.svg', '.ico', '.heic', '.avif'];
export const videoExtensions = ['.webm', '.mp4', '.wmv', '.avi', '.mov', '.mkv', '.mpeg', '.ogv'];

const thumbPath = fileURLToPath(new URL('../../../../uploads/thumbs', import.meta.url));
const videoPreviewPath = fileURLToPath(new URL('../../../../uploads/thumbs/preview', import.meta.url));

const generateThumbnailForImage = async ({
	filename,
	output,
	tmp = false,
	watched = false
}: {
	filename: string;
	output: string;
	tmp?: boolean;
	watched?: boolean;
}) => {
	const filePath = fileURLToPath(
		new URL(`../../../../uploads/${tmp ? 'tmp/' : ''}${watched ? 'live/' : ''}${filename}`, import.meta.url)
	);

	await new Promise((resolve, reject) => {
		ffmpeg(filePath)
			.size('256x?')
			// The output is already named `.webp`, so ffmpeg picks the muxer from the
			// extension. Setting `.format('webp')` explicitly makes fluent-ffmpeg run
			// its `-f` capability check, which reads `ffmpeg -formats`: that output
			// changed layout in ffmpeg 8 and no longer parses, making every thumbnail
			// fail with "Output format webp is not available".
			.output(path.join(thumbPath, output))
			.on('error', error => {
				logError(log, 'Could not generate the image thumbnail', error);
				return reject;
			})
			.on('end', resolve)
			.run();
	});

	if (tmp) await deleteTmpFile(filePath);
};

const generateThumbnailForVideo = async ({
	filename,
	output,
	tmp = false,
	watched = false
}: {
	filename: string;
	output: string;
	tmp?: boolean;
	watched?: boolean;
}) => {
	const filePath = fileURLToPath(
		new URL(`../../../../uploads/${tmp ? 'tmp/' : ''}${watched ? 'live/' : ''}${filename}`, import.meta.url)
	);

	await new Promise((resolve, reject) => {
		ffmpeg(filePath)
			.thumbnail({
				timestamps: [0],
				filename: '%b.webp',
				folder: thumbPath,
				size: '256x?'
			})
			.on('error', error => {
				logError(log, 'Could not generate the video thumbnail', error);
				return reject;
			})
			.on('end', resolve);
	});

	try {
		await previewUtil({
			input: filePath,
			width: 256,
			output: path.join(videoPreviewPath, output)
		});

		if (tmp) await deleteTmpFile(filePath);
	} catch (error) {
		logError(log, 'Could not generate the video preview', error);
	}
};

export const generateThumbnails = async ({
	filename,
	tmp = false,
	watched = false,
	force = false
}: {
	filename: string;
	force?: boolean;
	tmp?: boolean;
	watched?: boolean;
}) => {
	if (!SETTINGS.generateThumbnails && !force) return;
	if (!filename) return;
	const ext = path.extname(filename).toLowerCase();
	const output = `${filename.slice(0, -ext.length)}.webp`;
	const previewOutput = `${filename.slice(0, -ext.length)}.webm`;

	log.debug(`Generating thumbnails for ${filename}`);

	if (imageExtensions.includes(ext)) return generateThumbnailForImage({ filename, output, tmp, watched });

	if (videoExtensions.includes(ext))
		return generateThumbnailForVideo({ filename, output: previewOutput, tmp, watched });
	return null;
};

export const getFileThumbnail = (filename: string) => {
	if (!filename) return null;
	const ext = path.extname(filename).toLowerCase();

	const isImage = imageExtensions.includes(ext);
	const isVideo = videoExtensions.includes(ext);

	if (isImage) return { thumb: `${filename.slice(0, -ext.length)}.webp` };
	if (isVideo) {
		return {
			thumb: `${filename.slice(0, -ext.length)}.webp`,
			preview: `${filename.slice(0, -ext.length)}.webm`
		};
	}

	return null;
};

export const removeThumbs = async ({ thumb, preview }: { preview?: string; thumb?: string }) => {
	if (thumb) {
		await jetpack.removeAsync(path.join(thumbPath, thumb));
	}

	if (preview) {
		await jetpack.removeAsync(path.join(videoPreviewPath, preview));
	}
};
