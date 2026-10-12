import { settingsAtom } from '@/lib/atoms/settings';
import type { UploaderOptions } from '@chibisafe/uploader-client';
import { chibiUploader } from '@chibisafe/uploader-client';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { debug } from '@/lib/utils';
import { uploadsAtom } from '@/lib/atoms/uploads';
import { toast } from 'sonner';
import type { MultipartUploadTarget } from '@/lib/s3-multipart';
import { uploadFileInParts } from '@/lib/s3-multipart';

/*
	DigitalOcean Spaces requires the uploaded objects to be marked as public.
	The endpoint is parsed and its host compared to the Spaces domain instead of
	looking for the domain anywhere in the URL, so that an endpoint such as
	`digitaloceanspaces.com.example.com` is not mistaken for Spaces.
*/
const isDigitalOceanSpacesEndpoint = (endpoint: string) => {
	try {
		const labels = new URL(endpoint).hostname.split('.');
		return labels.slice(-2).join('.') === 'digitaloceanspaces.com';
	} catch {
		return false;
	}
};

export const useUploadFile = ({ albumUuid }: { readonly albumUuid?: string | undefined }) => {
	const settings = useAtomValue(settingsAtom);
	const setUploads = useSetAtom(uploadsAtom);

	/*
		Tells the backend that a file has been stored on the network storage, so it
		can create the database entry, check the quota and generate the thumbnails.
	*/
	const processNetworkStorageFile = useCallback(
		async ({
			identifier,
			name,
			type
		}: {
			identifier: string;
			name: string;
			type: string;
		}): Promise<{ error: string | undefined; url: string | undefined }> => {
			try {
				const response = await fetch('/api/upload/process', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						credentials: 'include',
						albumuuid: albumUuid ?? ''
					},
					body: JSON.stringify({ identifier, name, type })
				});

				if (!response.ok) {
					const error = await response.json();
					throw new Error(error.message);
				}

				const processed = (await response.json()) as { url: string };
				debug('Finished processing file', { name, url: processed.url });
				return { error: undefined, url: processed.url };
			} catch (error: any) {
				debug(`Error processing ${name}`, error.message);
				return { error: error.message as string, url: undefined };
			}
		},
		[albumUuid]
	);

	const uploadFile = useCallback(
		async ({
			endpoint,
			file,
			identifier = '',
			isNetworkStored,
			method = 'POST',
			multipart,
			publicUrl = ''
		}: {
			endpoint?: string | undefined;
			file: File;
			identifier?: string | undefined;
			isNetworkStored: boolean;
			method: 'POST' | 'PUT';
			multipart?: MultipartUploadTarget | undefined;
			publicUrl?: string | undefined;
		}) => {
			/*
				Files that are too big for a single request are uploaded to the network
				storage in parts, one part per pre-signed URL.
			*/
			if (multipart) {
				debug(`Started multipart upload of ${file.name} with uuid ${multipart.uploadId}`);
				setUploads(draft => {
					draft.push({
						uuid: multipart.uploadId,
						name: file.name,
						type: file.type,
						processing: true,
						status: 'uploading',
						bytesSent: 0,
						bytesTotal: file.size,
						progress: 0,
						url: '',
						albumUuid: albumUuid ?? null
					});
				});

				try {
					await uploadFileInParts({
						file,
						target: multipart,
						onProgress: (bytesSent, progress) => {
							setUploads(draft => {
								const upload = draft.findIndex(entry => entry.uuid === multipart.uploadId);
								if (upload !== -1) {
									draft[upload]!.bytesSent = bytesSent;
									draft[upload]!.progress = progress;
								}
							});
						}
					});

					// The backend collects the uploaded parts and commits the object
					const completed = await fetch('/api/upload/multipart/complete', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							credentials: 'include',
							albumuuid: albumUuid ?? ''
						},
						body: JSON.stringify({ uploadId: multipart.uploadId, key: identifier, size: file.size })
					});

					if (!completed.ok) {
						const error = await completed.json();
						throw new Error(error.message);
					}

					const { error, url } = await processNetworkStorageFile({
						identifier,
						name: file.name,
						type: file.type
					});
					setUploads(draft => {
						const upload = draft.findIndex(entry => entry.uuid === multipart.uploadId);
						if (upload !== -1) {
							draft[upload]!.status = error ? 'error' : 'success';
							if (error) draft[upload]!.error = error;
							if (url) draft[upload]!.url = url;
							draft[upload]!.processing = false;
						}
					});

					if (error) toast.error(error);
				} catch (error: any) {
					debug(`Error uploading ${file.name} with uuid ${multipart.uploadId}`, error.message);
					setUploads(draft => {
						const upload = draft.findIndex(entry => entry.uuid === multipart.uploadId);
						if (upload !== -1) {
							draft[upload]!.status = 'error';
							draft[upload]!.error = error.message;
							draft[upload]!.processing = false;
						}
					});
					toast.error(error.message);
				}

				return;
			}

			const options: UploaderOptions = {
				debug: process.env.NODE_ENV !== 'production',
				endpoint: endpoint ?? '',
				file,
				method,
				maxFileSize: settings?.maxSize ?? 0,
				// If we're storing in s3, we don't want to chunk the file. Files that
				// are too big for a single PUT request are uploaded in parts instead.
				chunkSize: isNetworkStored ? (settings?.maxSize ?? 0) : (settings?.chunkSize ?? 0),
				autoStart: true,
				maxParallelUploads: 1
			};

			if (isNetworkStored) {
				options.headers = {
					'Content-Type': file.type
				};

				if (isDigitalOceanSpacesEndpoint(endpoint ?? '')) {
					options.headers['x-amz-acl'] = 'public-read';
				}
			} else {
				options.postParams = {
					name: file.name,
					type: file.type,
					size: file.size.toString()
				};

				options.headers = {
					credentials: 'include',
					albumuuid: albumUuid ?? ''
				};
			}

			await chibiUploader({
				...options,
				onStart: (uuid: string, totalChunks: number) => {
					debug(`Started uploading ${file.name} with uuid ${uuid} and ${totalChunks} chunks`);
					setUploads(draft => {
						draft.push({
							uuid,
							name: file.name,
							type: file.type,
							processing: true,
							status: 'uploading',
							bytesSent: 0,
							bytesTotal: file.size,
							progress: 0,
							url: '',
							albumUuid: albumUuid ?? null
						});
					});
				},
				onError: (uuid: string, error: any) => {
					debug(`Error uploading ${file.name} with uuid ${uuid}`, error.message);
					setUploads(draft => {
						const upload = draft.findIndex(file => file.uuid === uuid);
						if (upload !== -1) {
							draft[upload]!.status = 'error';
							draft[upload]!.error = error.message;
							draft[upload]!.processing = false;
						}
					});
				},
				onProgress: (uuid: string, progress: any) => {
					debug(`Progress uploading ${file.name} with uuid ${uuid}`, progress);
					setUploads(draft => {
						const upload = draft.findIndex(u => u.uuid === uuid);
						if (upload !== -1) {
							draft[upload]!.progress = progress;
						}
					});
				},
				onRetry: (_, reason: any) => {
					debug('Retrying upload', reason);
				},
				onFinish: async (uuid: string, response: any) => {
					if (isNetworkStored) {
						debug('Finished uploading file to S3 storage', {
							name: file.name,
							uuid,
							url: publicUrl
						});

						setUploads(draft => {
							const upload = draft.findIndex(file => file.uuid === uuid);
							if (upload !== -1) {
								draft[upload]!.status = 'success';
								draft[upload]!.url = publicUrl;
								draft[upload]!.processing = false;
							}
						});

						const { error, url } = await processNetworkStorageFile({
							identifier,
							name: file.name,
							type: file.type
						});
						setUploads(draft => {
							const upload = draft.findIndex(file => file.uuid === uuid);
							if (upload !== -1) {
								draft[upload]!.status = error ? 'error' : 'success';
								if (error) draft[upload]!.error = error;
								if (url) draft[upload]!.url = url;
								draft[upload]!.processing = false;
							}
						});

						if (error) toast.error(error);
						return null;
					}

					debug('Finished uploading file', {
						name: file.name,
						uuid,
						url: response.url
					});

					setUploads(draft => {
						const upload = draft.findIndex(file => file.uuid === uuid);
						if (upload !== -1) {
							draft[upload]!.status = 'success';
							draft[upload]!.url = response.url;
							draft[upload]!.processing = false;
						}
					});
					return null;
				}
			});
		},
		[albumUuid, processNetworkStorageFile, setUploads, settings?.chunkSize, settings?.maxSize]
	);

	return { uploadFile };
};
