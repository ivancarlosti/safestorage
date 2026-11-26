'use client';

import type { Settings } from '@/types';
import type { DropItem } from 'react-aria-components';
import { isDirectoryDropItem, isFileDropItem } from 'react-aria-components';
import type { MultipartUploadTarget } from './s3-multipart';
import { getUploadContentType } from './file';

/*
	One picked or dropped file together with the path it keeps inside a website
	album. The path is the browser's relative path for a folder picker
	(`webkitRelativePath`) and is rebuilt from the dropped folders otherwise: a
	drop of `dist/` yields `dist/css/app.css`, so the file is served as
	`css/app.css` once the folder itself is stripped.
*/
export interface UploadEntry {
	file: File;
	sitePath: string;
}

/*
	An extension is only checked when the name actually has one. `CNAME`,
	`_headers` and `.well-known` have none and a website cannot do without
	them, so they always pass.
*/
const isBlockedExtension = (name: string, settings: Settings | null) => {
	const lastDot = name.lastIndexOf('.');
	if (lastDot <= 0) return false;

	return (
		Boolean(settings?.blockedExtensions.length) &&
		Boolean(settings?.blockedExtensions.includes(name.slice(lastDot).toLowerCase()))
	);
};

const collectDirectoryEntries = async (
	item: DropItem,
	settings: Settings | null,
	prefix: string
): Promise<UploadEntry[]> => {
	if (isFileDropItem(item)) {
		const file = await item.getFile();
		if (isBlockedExtension(file.name, settings)) return [];

		// react-aria reports the bare name for a dropped file, so the folders
		// the file was dropped in are put back in front of it
		const droppedPath = prefix ? `${prefix}/${item.name}` : item.name;
		return [{ file, sitePath: file.webkitRelativePath || droppedPath }];
	}

	if (isDirectoryDropItem(item)) {
		const directory = prefix ? `${prefix}/${item.name}` : item.name;
		const entries: UploadEntry[] = [];
		for await (const child of item.getEntries()) {
			entries.push(...(await collectDirectoryEntries(child, settings, directory)));
		}

		return entries;
	}

	return [];
};

export const processDropItem = async (item: DropItem | File, settings: Settings | null): Promise<UploadEntry[]> => {
	if (item instanceof File) {
		if (isBlockedExtension(item.name, settings)) return [];

		return [{ file: item, sitePath: item.webkitRelativePath || item.name }];
	}

	return collectDirectoryEntries(item, settings, '');
};

/*
	Picking or dropping a folder prefixes every path with the folder that was
	selected (`dist/index.html`, `dist/css/app.css`). That folder is the
	container, not part of the site, so it is removed from the whole selection at
	once - but only when every path shares it, otherwise nothing is touched and a
	loose pick of `a.txt` + `b.txt` keeps its names.
*/
export const stripCommonRoot = (entries: UploadEntry[]): UploadEntry[] => {
	if (entries.length === 0) return entries;

	const root = entries[0]!.sitePath.split('/')[0];
	if (!root) return entries;

	const prefix = `${root}/`;
	const stripped: string[] = [];
	for (const entry of entries) {
		if (!entry.sitePath.startsWith(prefix)) return entries;

		const sitePath = entry.sitePath.slice(prefix.length);
		if (!sitePath) return entries;
		stripped.push(sitePath);
	}

	return entries.map((entry, index) => ({ ...entry, sitePath: stripped[index]! }));
};

/*
	Resolves everything a drop or a file selection produced. The common root is
	stripped over the whole selection, so a picked folder and a dropped folder
	end up serving the same paths.
*/
export const processDropItems = async (
	items: Iterable<DropItem | File>,
	settings: Settings | null
): Promise<UploadEntry[]> => {
	const entries: UploadEntry[] = [];
	for (const item of items) {
		entries.push(...(await processDropItem(item, settings)));
	}

	return stripCommonRoot(entries);
};

export type SignedUploadTarget =
	| { endpoint: string; identifier: string; publicUrl: string }
	| { identifier: string; multipart: MultipartUploadTarget; publicUrl: string };

/*
	Asks the backend how a file should be uploaded to the network storage:
	small files get a single pre-signed URL, while files that are too big for a
	single request get a pre-signed URL for every part of a multipart upload.

	`sitePath` is the place of the file inside a website album. The backend puts
	it in the storage key, so it has to be the path the website serves.
*/
export const getSignedUrl = async (
	file: File,
	albumLink?: string,
	albumUuid?: string,
	sitePath?: string
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
			contentType: getUploadContentType(file),
			name: file.name,
			sitePath,
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
