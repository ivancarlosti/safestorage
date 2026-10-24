import { z } from 'zod';
import { fileAlbumSchema, fileAsUserSchema } from './FileAsUser.js';

export const fileAsUserWithAlbumsSchema = fileAsUserSchema.extend({
	albums: z.array(fileAlbumSchema).optional(),
	tags: z
		.array(
			z.object({
				uuid: z.string().describe('The uuid of the tag.'),
				name: z.string().describe('The name of the tag.')
			})
		)
		.optional()
});
