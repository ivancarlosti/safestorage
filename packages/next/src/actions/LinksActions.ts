'use server';

import { MessageType } from '@/types';
import request from '@/lib/request';
import { getToken } from './utils';

export interface CreateShortUrlState {
	link?: string | undefined;
	message: string;
	type: MessageType;
}

/*
	Short URLs are created on the YOURLS instance configured in the admin
	settings, so the response is simply relayed: the link only exists there and
	can not be listed or deleted through safestorage.
*/
export const createShortURL = async (_: CreateShortUrlState, form: FormData): Promise<CreateShortUrlState> => {
	const url = form.get('url') as string;
	const vanity = form.get('vanity') as string;

	try {
		const { data, error } = await request.post({
			url: 'link/create',
			headers: {
				authorization: `Bearer ${await getToken()}`
			},
			body: {
				url,
				vanity: vanity || undefined
			}
		});

		if (error) return { message: error, type: MessageType.Error };

		return {
			link: data?.link?.link as string | undefined,
			message: 'Link created',
			type: MessageType.Success
		};
	} catch (error: any) {
		return { message: error, type: MessageType.Error };
	}
};
