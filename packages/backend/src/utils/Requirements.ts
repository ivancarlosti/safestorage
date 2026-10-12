import process from 'node:process';
import { lookpath } from 'lookpath';

export default async (log: any) => {
	const nodeMajorVersion = process.versions.node.split('.')[0];
	if (Number(nodeMajorVersion) < 18) {
		log.error('safestorage needs node v18 or newer to run properly, please upgrade.');
		process.exit(1);
	}

	log.debug('Node version: OK');

	const ffmpegExists = await lookpath('ffmpeg');
	if (!ffmpegExists) {
		log.error(
			"safestorage couldn't find ffmpeg in your path. ffmpeg is needed to process thumbnails for uploads, please install it."
		);
		process.exit(1);
	}

	log.debug('ffmpeg: OK');
};
