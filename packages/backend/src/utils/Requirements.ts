import process from 'node:process';
import { lookpath } from 'lookpath';
import { AUTH_METHOD, validateAuthConfiguration } from '@/structures/auth.js';

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

	/*
		An incoherent authentication configuration is caught here, at boot, rather
		than on the first login attempt: under `keycloak` a missing client id or an
		empty allow-list would otherwise leave the instance either unusable or open
		to self-provisioning by anyone who can reach the provider.
	*/
	const { errors, warnings } = validateAuthConfiguration();

	for (const warning of warnings) log.warn(warning);

	if (errors.length > 0) {
		for (const error of errors) log.error(error);
		log.error('Fix the authentication environment variables above and restart safestorage.');
		process.exit(1);
	}

	log.debug(`Authentication method: ${AUTH_METHOD}`);
};
