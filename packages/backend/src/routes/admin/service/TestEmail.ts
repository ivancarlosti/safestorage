import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';
import { sendTestMail } from '@/utils/Mailer.js';

export const schema = {
	summary: 'Send test email',
	description: 'Sends a test email to the logged in admin to check the SMTP settings',
	tags: ['Server'],
	response: {
		200: z.object({
			message: responseMessageSchema
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/admin/service/settings/test-email',
	method: 'post',
	middlewares: ['apiKey', 'auth', 'admin'],
	options: {
		rateLimit: {
			max: 5,
			timeWindow: 1000 * 60
		}
	}
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	// The admin's own email is the destination: no address has to be typed in.
	const result = await sendTestMail(req.user.username);

	if (!result.sent) {
		void res.badRequest(result.error ?? 'The test email could not be sent');
		return;
	}

	return res.send({
		message: 'The test email was sent'
	});
};
