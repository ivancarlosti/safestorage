'use client';

import type { UploadEntry } from '@/lib/dropzone';
import { getSignedUrl } from '@/lib/dropzone';
import type { UploadFileOptions } from '@/hooks/useUploadFile';
import { uploadQueue } from '@/lib/uploadQueue';

/*
	Uploads a whole drop or file selection.

	Four components used to duplicate this loop, each deciding on its own how a
	file reaches the storage. Keeping it in one place means the website path of
	every file is sent along on all of them: local uploads as a form field,
	network storage in the signed URL request and again when the backend is told
	the file is stored.
*/
export const uploadEntries = async ({
	albumLink,
	albumUuid,
	entries,
	failUpload,
	uploadFile,
	useNetworkStorage
}: {
	albumLink?: string | undefined;
	albumUuid?: string | undefined;
	entries: UploadEntry[];
	failUpload: (file: File, message: string) => void;
	uploadFile: (options: UploadFileOptions) => Promise<void>;
	useNetworkStorage: boolean;
}) => {
	for (const { file, sitePath } of entries) {
		void uploadQueue.add(async () => {
			if (!useNetworkStorage) {
				await uploadFile({
					endpoint: '/api/upload',
					file,
					isNetworkStored: false,
					method: 'POST',
					sitePath
				});
				return;
			}

			const target = await getSignedUrl(file, albumLink, albumUuid, sitePath);
			if ('error' in target) {
				failUpload(file, target.error);
				return;
			}

			await uploadFile({
				file,
				isNetworkStored: true,
				method: 'PUT',
				sitePath,
				...target
			});
		});
	}
};
