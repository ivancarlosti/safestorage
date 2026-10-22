'use server';

import type { ViewMode } from '@/types';
import { revalidateTag } from 'next/cache';
import { MessageType } from '@/types';
import request from '@/lib/request';
import { getToken } from './utils';

export const updateAlbumSettings = async (_: any, form: FormData) => {
	const uuid = form.get('uuid') as string;

	const name = form.get('name') as string;
	if (!name) return { message: 'Name is required', type: MessageType.Error };

	const description = form.get('description') as string;
	const nsfw = form.get('nsfw') === 'on';
	const sortOrder = (form.get('sortOrder') as string) || null;
	const viewMode = (form.get('viewMode') as ViewMode) || 'thumbs';

	try {
		const { error } = await request.post({
			url: `album/${uuid}/edit`,
			body: {
				name,
				description,
				nsfw,
				sortOrder,
				viewMode
			},
			headers: {
				authorization: `Bearer ${await getToken()}`
			}
		});

		if (error) return { message: error, type: MessageType.Error };

		revalidateTag('albums');
		revalidateTag('album');
		return { message: 'Album updated', type: MessageType.Success };
	} catch (error: any) {
		return { message: error, type: MessageType.Error };
	}
};

export const updateAlbumViewMode = async (uuid: string, viewMode: ViewMode) => {
	try {
		const { error } = await request.post({
			url: `album/${uuid}/edit`,
			body: {
				viewMode
			},
			headers: {
				authorization: `Bearer ${await getToken()}`
			}
		});

		if (error) return { message: error, type: MessageType.Error };

		revalidateTag('albums');
		revalidateTag('album');
		return { message: 'Album updated', type: MessageType.Success };
	} catch (error: any) {
		return { message: error, type: MessageType.Error };
	}
};
