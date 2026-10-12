'use server';

import { revalidateTag } from 'next/cache';
import { MessageType } from '@/types';
import request from '@/lib/request';
import { getToken } from './utils';

/*
	Used directly as a `<form action>` in a Server Component, so — as required by
	React 19's action typings — it must resolve to `void` rather than to a state
	object. The created invite is surfaced through the revalidated `invites` tag.
*/
export const createInvite = async (_: FormData): Promise<void> => {
	try {
		const { error } = await request.post({
			url: 'admin/invite/create',
			headers: {
				authorization: `Bearer ${await getToken()}`
			}
		});

		if (error) return;

		revalidateTag('invites');
	} catch {
		// The invites list is revalidated on success; failures have no dedicated UI here.
	}
};

export const revokeInvite = async (uuid: string) => {
	try {
		const { error } = await request.post({
			url: 'admin/invite/delete',
			body: {
				code: uuid
			},
			headers: {
				authorization: `Bearer ${await getToken()}`
			}
		});

		if (error) return { message: error, type: MessageType.Error };

		revalidateTag('invites');
		return { message: 'Invite revoked', type: MessageType.Success };
	} catch (error: any) {
		return { message: error, type: MessageType.Error };
	}
};
