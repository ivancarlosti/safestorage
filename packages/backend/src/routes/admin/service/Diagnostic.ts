import { URL, fileURLToPath } from 'node:url';
import envinfo from 'envinfo';
import type { FastifyReply } from 'fastify';
import jetpack from 'fs-jetpack';
import { z } from 'zod';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { readLogTail, sanitizeLogs } from '@/utils/LogSanitizer.js';
import { redactPaths } from '@/utils/Sanitizer.js';

export const schema = {
	summary: 'Save settings',
	description: 'Save the safestorage instance settings',
	tags: ['Server'],
	response: {
		200: z.object({
			diagnostics: z.string().describe('The diagnostics string.')
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/admin/service/diagnostic',
	method: 'get',
	middlewares: ['apiKey', 'auth', 'admin']
};

export const run = async (_: RequestWithUser, res: FastifyReply) => {
	const auditPath = fileURLToPath(new URL('../../../../../../logs/safestorage-audit.json', import.meta.url));
	const logsAudit = await jetpack.readAsync(auditPath, 'json');
	const files: { name: string }[] = logsAudit?.files ?? [];
	const logsFile = files[files.length - 1];

	// `fs-jetpack` returns an empty `files` array when the log rotation file has
	// not been written yet (a brand new instance or an external log driver)
	let logs = 'No log file available.';
	if (logsFile?.name) {
		try {
			logs = await readLogTail(logsFile.name);
		} catch {
			// The audit file can point at a log that was already rotated away
			logs = 'Could not read the log file.';
		}
	}

	const envInfo = await envinfo.run(
		{
			// `Shell` is left out: it is the only entry that reports an absolute
			// path, and the shell flavour adds nothing on top of OS/version
			System: ['OS', 'CPU', 'Memory'],
			Binaries: ['Node', 'Yarn', 'npm'],
			Virtualization: ['Docker']
		},
		{
			showNotFound: true
		}
	);

	// The logs are truncated, stripped of their absolute paths, their client
	// addresses and their credentials before leaving the instance
	const diagnostics = `${redactPaths(envInfo.trim())}\n\n${sanitizeLogs(logs)}`;
	return res.send({ diagnostics });
};
