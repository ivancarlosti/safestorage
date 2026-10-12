'use server';

import { MessageType } from '@/types';
import request from '@/lib/request';
import { getToken } from './utils';
import { revalidateTag } from 'next/cache';

/*
	Bound to a uuid and used directly as a `<form action>`, so — as required by
	React 19's action typings — it must resolve to `void` rather than to a state
	object. The regenerated thumbnail is surfaced through the `files` tag.
*/
export const regenerateThumbnail = async (uuid: string): Promise<void> => {
	try {
		await request.post({
			url: `file/${uuid}/thumbnail/regenerate`,
			headers: {
				authorization: `Bearer ${await getToken()}`
			}
		});

		revalidateTag('files');
	} catch {
		// The files list is revalidated on success; failures have no dedicated UI here.
	}
};

export const deleteFile = async (uuid: string) => {
	try {
		const { error } = await request.delete({
			url: `file/${uuid}`,
			headers: {
				authorization: `Bearer ${await getToken()}`
			}
		});

		if (error) return { message: error, type: MessageType.Error };

		revalidateTag('files');

		return { message: 'File deleted', type: MessageType.Success };
	} catch (error: any) {
		return { message: error, type: MessageType.Error };
	}
};

export const deleteFileAsAdmin = async (uuid: string) => {
	try {
		const { error } = await request.delete({
			url: `admin/file/${uuid}`,
			headers: {
				authorization: `Bearer ${await getToken()}`
			}
		});

		if (error) return { message: error, type: MessageType.Error };

		revalidateTag('files');

		return { message: 'File deleted', type: MessageType.Success };
	} catch (error: any) {
		return { message: error, type: MessageType.Error };
	}
};

export const quarantineFile = async (uuid: string) => {
	try {
		const { error } = await request.post({
			url: `admin/file/${uuid}/quarantine`,
			headers: {
				authorization: `Bearer ${await getToken()}`
			}
		});

		if (error) return { message: error, type: MessageType.Error };

		revalidateTag('files');

		return { message: 'File quarantined', type: MessageType.Success };
	} catch (error: any) {
		return { message: error, type: MessageType.Error };
	}
};

export const allowFile = async (uuid: string) => {
	try {
		const { error } = await request.post({
			url: `admin/file/${uuid}/allow`,
			headers: {
				authorization: `Bearer ${await getToken()}`
			}
		});

		if (error) return { message: error, type: MessageType.Error };

		revalidateTag('files');

		return { message: 'File allowed', type: MessageType.Success };
	} catch (error: any) {
		return { message: error, type: MessageType.Error };
	}
};
