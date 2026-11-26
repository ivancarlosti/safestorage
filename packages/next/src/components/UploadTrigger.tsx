'use client';

import { useAtomValue } from 'jotai';
import { forwardRef, useCallback } from 'react';
import type { FileTriggerProps } from 'react-aria-components';
import { FileTrigger } from '@/components/ui/file-trigger';
import { processDropItems } from '@/lib/dropzone';
import { settingsAtom } from '@/lib/atoms/settings';
import { uploadEntries } from '@/lib/uploadEntries';
import { useUploadFile } from '@/hooks/useUploadFile';

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

			const entries = await processDropItems(files, settings);
			await uploadEntries({
				entries,
				albumLink: props.albumLink,
				albumUuid: props.albumUuid,
				failUpload,
				uploadFile,
				useNetworkStorage: Boolean(settings?.useNetworkStorage)
			});
		},
		[failUpload, props.albumLink, props.albumUuid, settings, uploadFile]
	);

	return (
		<FileTrigger {...additionalProps} onSelect={onSelect} ref={ref} allowsMultiple>
			{children}
		</FileTrigger>
	);
});
