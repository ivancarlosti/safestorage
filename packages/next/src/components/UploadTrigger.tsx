'use client';

import { useAtomValue } from 'jotai';
import { forwardRef, useCallback } from 'react';
import type { FileTriggerProps } from 'react-aria-components';
import { FileTrigger } from '@/components/ui/file-trigger';
import { getSignedUrl, processDropItem } from '@/lib/dropzone';
import { settingsAtom } from '@/lib/atoms/settings';
import { useUploadFile } from '@/hooks/useUploadFile';
import { uploadQueue } from '@/lib/uploadQueue';

interface FileTriggerPropsWithAlbumUuid extends FileTriggerProps {
	readonly albumLink?: string;
	readonly albumUuid?: string;
}

export const UploadTrigger = forwardRef<HTMLInputElement, FileTriggerPropsWithAlbumUuid>((props, ref) => {
	const { children, ...additionalProps } = props;
	const settings = useAtomValue(settingsAtom);

	const { failUpload, uploadFile } = useUploadFile({
		albumUuid: props.albumUuid ?? undefined,
		albumLink: props.albumLink
	});

	const onSelect = useCallback(
		async (files: FileList | null) => {
			if (files === null) {
				return;
			}

			for (const item of files) {
				const files = await processDropItem(item, settings);
				if (!files.length) continue;

				if (!settings?.useNetworkStorage) {
					void files.map(
						async file =>
							void uploadQueue.add(async () =>
								uploadFile({
									file: file instanceof File ? file : await file.getFile(),
									endpoint: '/api/upload',
									isNetworkStored: false,
									method: 'POST'
								})
							)
					);
					continue;
				}

				void files.map(async file => {
					void uploadQueue.add(async () => {
						const actualFile = file instanceof File ? file : await file.getFile();
						const target = await getSignedUrl(actualFile, props.albumLink, props.albumUuid);
						if ('error' in target) {
							failUpload(actualFile, target.error);
							return;
						}

						await uploadFile({
							file: actualFile,
							isNetworkStored: true,
							method: 'PUT',
							...target
						});
					});
				});
			}
		},
		[failUpload, props.albumLink, props.albumUuid, settings, uploadFile]
	);

	return (
		<FileTrigger {...additionalProps} onSelect={onSelect} ref={ref} allowsMultiple>
			{children}
		</FileTrigger>
	);
});
