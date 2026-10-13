import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';
import type { SETTINGS } from '@/structures/settings.js';
import { loadSettings } from '@/structures/settings.js';
import { logError } from '@/utils/Logger.js';
import { isValidSortOrder } from '@/utils/SortOrder.js';
import { updateCheck, startUpdateCheckSchedule, stopUpdateCheckSchedule } from '@/utils/UpdateCheck.js';

export const schema = {
	summary: 'Save settings',
	description: 'Save the safestorage instance settings',
	tags: ['Server'],
	body: z.object({
		settings: z
			.array(
				z.object({
					key: z.string().describe('The key of the setting.'),
					value: z.coerce.string().describe('The value of the setting.'),
					type: z.string().describe('The type of the setting.')
				})
			)
			.describe('Items to save in the settings.')
	}),
	response: {
		200: z.object({
			message: responseMessageSchema
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/admin/service/settings',
	method: 'post',
	middlewares: ['apiKey', 'auth', 'admin']
};

type incomingSettings = {
	key: string;
	type: string;
	value: string;
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const { settings }: { settings: string } = req.body as { settings: string };

	try {
		const parsedSettings: Partial<typeof SETTINGS> = {};
		for (const item of settings as unknown as incomingSettings[]) {
			if (item.key === 'defaultSortOrder' && (!item.value || !isValidSortOrder(item.value))) {
				void res.badRequest('Invalid default sort order');
				return;
			}

			if (item.type === 'boolean') parsedSettings[item.key] = item.value === 'true';
			else if (item.type === 'number') parsedSettings[item.key] = Number(item.value);
			else parsedSettings[item.key] = item.value;
		}

		/*
			The database stores chunkSize, maxSize and usersStorageQuota as strings even
			though they hold numbers. Only convert the values that are part of this
			request: `String(undefined)` would write the literal "undefined" over the
			stored value, which then reads back as NaN (and as `null` over the API, which
			breaks the settings schema in the frontend).
		*/
		if (parsedSettings.chunkSize !== undefined) {
			// @ts-expect-error chunkSize is a string on the db, but int here.
			parsedSettings.chunkSize = String(parsedSettings.chunkSize);
		}

		if (parsedSettings.maxSize !== undefined) {
			// @ts-expect-error maxSize is a string on the db, but int here.
			parsedSettings.maxSize = String(parsedSettings.maxSize);
		}

		if (parsedSettings.usersStorageQuota !== undefined) {
			// @ts-expect-error usersStorageQuota is a string on the db, but int here.
			parsedSettings.usersStorageQuota = String(parsedSettings.usersStorageQuota);
		}

		await prisma.settings.update({
			where: {
				id: 1
			},
			// @ts-ignore
			data: {
				...parsedSettings
			}
		});

		await res.send({ message: 'Settings updated' });
		// Refresh the instance settings
		await loadSettings(true);

		// Option is enabled, but the schedule is not running
		if (!parsedSettings.disableUpdateCheck && !updateCheck.active) {
			await startUpdateCheckSchedule();
			// Option is disabled, but the schedule is running
		} else if (parsedSettings.disableUpdateCheck && updateCheck.active) {
			stopUpdateCheckSchedule();
		}
	} catch (error) {
		logError(req.log, 'Could not save the settings', error);
		void res.internalServerError(error as string);
	}
};
