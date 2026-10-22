'use client';

import type { Settings } from '@/types';
import type { DropItem, FileDropItem } from 'react-aria-components';
import { isDirectoryDropItem, isFileDropItem } from 'react-aria-components';
import type { MultipartUploadTarget } from './s3-multipart';
import { getFileExtension } from './file';

export const processDropItem = async (item: DropItem | File, settings: Settings | null) => {
	if (item instanceof File) {
		if (settings?.blockedExtensions.length) {
			const extension = getFileExtension(item.name);
			if (!extension) return [];
			if (settings?.blockedExtensions.includes(`.${extension}`)) {
				return [];
			}
		}

		return [item];
	}

	if (isFileDropItem(item)) {
		if (settings?.blockedExtensions.length) {
			const extension = getFileExtension(item.name);
			if (!extension) return [];
			if (settings?.blockedExtensions.includes(`.${extension}`)) {
				return [];
			}
		}

		return [item];
	} else if (isDirectoryDropItem(item)) {
		const dir = item.getEntries();
		const items: (File | FileDropItem)[] = [];
		for await (const entry of dir) {
			const item = await processDropItem(entry, settings);
			items.push(...item);
		}

		return items;
	}

	return [];
};

export type SignedUploadTarget =
	| { endpoint: string; identifier: string; publicUrl: string }
	| { identifier: string; multipart: MultipartUploadTarget; publicUrl: string };

/*
	Asks the backend how a file should be uploaded to the network storage:
	small files get a single pre-signed URL, while files that are too big for a
	single request get a pre-signed URL for every part of a multipart upload.
*/
export const getSignedUrl = async (
	file: File,
	albumLink?: string,
	albumUuid?: string
): Promise<SignedUploadTarget | { error: string }> => {
	const response = await fetch('/api/upload', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			credentials: 'include',
			albumlink: albumLink ?? '',
			albumuuid: albumUuid ?? ''
		},
		body: JSON.stringify({
			contentType: file.type,
			name: file.name,
			size: file.size
		})
	});

	if (!response.ok) {
		const error = await response.json();
		return { error: error.message };
	}

	const { url, identifier, publicUrl, multipart } = await response.json();
	if (multipart) {
		return { identifier, multipart: multipart as MultipartUploadTarget, publicUrl };
	}

	return { endpoint: url, identifier, publicUrl };
};
