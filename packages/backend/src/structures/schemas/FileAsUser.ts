import { z } from 'zod';

export const fileAlbumSchema = z
	.object({
		uuid: z.string().describe('The uuid of the album.'),
		name: z.string().describe('The name of the album.'),
		user: z
			.object({
				uuid: z.string().describe("The uuid of the album's owner."),
				username: z.string().describe("The username of the album's owner.")
			})
			.nullable()
			.optional()
			.describe('The owner of the album.')
	})
	.describe('The album object.');

export const fileAsUserSchema = z
	.object({
		name: z.string().describe('The name of the file.'),
		createdAt: z.date().describe('The date the file was uploaded.'),
		ip: z.string().describe('The IP address of the uploader.'),
		original: z.string().describe('The original name of the file.'),
		uuid: z.string().describe('The uuid of the file.'),
		hash: z.string().describe('The hash of the file.'),
		size: z.coerce.number().describe('The size of the file in bytes.'),
		type: z.string().describe('The type of the file.'),
		url: z.string().describe('The URL of the file.'),
		thumb: z.string().describe('The URL of the thumbnail of the file.'),
		preview: z.string().describe('The URL of the preview of the file.'),
		quarantine: z.boolean().optional().describe('Whether the file is quarantined.'),
		albums: z.array(fileAlbumSchema).optional().describe('The albums the file belongs to.'),
		sourceUrl: z.string().nullable().optional().describe('The source URL of the file.')
	})
	.describe('The file object.');
