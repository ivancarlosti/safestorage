import { settingsAtom } from '@/lib/atoms/settings';
import { currentUserAtom } from '@/lib/atoms/currentUser';
import type { UploaderOptions } from '@safestorage/uploader-client';
import { safeStorageUploader } from '@safestorage/uploader-client';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { debug } from '@/lib/utils';
import { uploadsAtom } from '@/lib/atoms/uploads';
import { formatBytes, getUploadContentType } from '@/lib/file';
import { randomUuid } from '@/lib/random';
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

export const useUploadFile = ({
	albumUuid,
	albumLink
}: {
	readonly albumLink?: string | undefined;
	readonly albumUuid?: string | undefined;
}) => {
	const settings = useAtomValue(settingsAtom);
	const currentUser = useAtomValue(currentUserAtom);
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
						albumuuid: albumUuid ?? '',
						albumlink: albumLink ?? ''
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
		[albumLink, albumUuid]
	);

	/*
		Files can be refused before a single byte is sent: the instance settings
		may still be loading, the file may be bigger than the configured maximum
		size or the network storage may reject the request. Those failures have no
		upload uuid yet, so an entry is created here to keep them visible in the
		upload panel instead of letting it report "All uploads complete".
	*/
	const failUpload = useCallback(
		(file: File, message: string) => {
			debug(`Upload of ${file.name} failed`, message);
			setUploads(draft => {
				draft.push({
					uuid: `local-${randomUuid()}`,
					name: file.name,
					type: file.type,
					processing: false,
					status: 'error',
					bytesSent: 0,
					bytesTotal: file.size,
					progress: 0,
					url: undefined,
					albumUuid: albumUuid ?? null,
					error: message
				});
			});
			toast.error(`${file.name}: ${message}`);
		},
		[albumUuid, setUploads]
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
							albumuuid: albumUuid ?? '',
							albumlink: albumLink ?? ''
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
						type: getUploadContentType(file)
					});
					setUploads(draft => {
						const upload = draft.findIndex(entry => entry.uuid === multipart.uploadId);
						if (upload !== -1) {
							draft[upload]!.status = error ? 'error' : 'success';
							if (error) draft[upload]!.error = error;
							if (url) draft[upload]!.url = url;
							draft[upload]!.processing = false;

							// All the parts were sent: the bar has to show that
							// instead of stopping a few percent short.
							if (!error) {
								draft[upload]!.progress = 100;
								draft[upload]!.bytesSent = file.size;
							}
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

			/*
				The maximum file size and the chunk size live in the instance
				settings. Without them the uploader would refuse every file (a max
				size of zero) or compute an infinite number of chunks (a chunk size of
				zero), so refuse the upload with an explicit reason instead.
			*/
			if (!settings) {
				failUpload(
					file,
					'The instance settings are not loaded yet, so nothing was uploaded. Reload the page and try again.'
				);
				return;
			}

			/*
				Public links can lower the maximum size for anonymous uploads. The
				backend enforces the same cap, this only gives the visitor a clear
				error before the file is sent.
			*/
			const { chunkSize } = settings;
			const anonymousUpload = Boolean(albumLink) || !currentUser;
			const maxSize =
				anonymousUpload && settings.anonymousUploadsMaxSize > 0
					? Math.min(settings.maxSize, settings.anonymousUploadsMaxSize)
					: settings.maxSize;
			/*
				Network storage sends the file as a single PUT, so its "chunk" is
				the whole file. A chunk size of zero would make the chunk count
				infinite, hence the fallback that the uploader itself uses.
			*/
			const uploadChunkSize = (isNetworkStored ? maxSize : chunkSize) || 81_000_000;

			if (!isNetworkStored) {
				if (maxSize <= 0) {
					failUpload(
						file,
						'This instance does not allow any file size (Max Size is 0), so uploads are disabled. Ask an administrator to set a maximum file size.'
					);
					return;
				}

				if (file.size > maxSize) {
					/*
						The chunk size and the chunk count are included so the limits
						that apply can be compared at a glance when a file is refused.
					*/
					const chunks = Math.ceil(file.size / uploadChunkSize);
					failUpload(
						file,
						`The file is ${formatBytes(file.size)}, but this instance allows at most ${formatBytes(maxSize)} per file (it would be split into ${chunks} chunks of ${formatBytes(uploadChunkSize)}).`
					);
					return;
				}
			}

			const options: UploaderOptions = {
				debug: process.env.NODE_ENV !== 'production',
				endpoint: endpoint ?? '',
				file,
				method,
				maxFileSize: maxSize,
				// If we're storing in s3, we don't want to chunk the file. Files that
				// are too big for a single PUT request are uploaded in parts instead.
				chunkSize: uploadChunkSize,
				autoStart: true,
				maxParallelUploads: 1
			};

			if (isNetworkStored) {
				options.headers = {
					'Content-Type': getUploadContentType(file)
				};

				if (isDigitalOceanSpacesEndpoint(endpoint ?? '')) {
					options.headers['x-amz-acl'] = 'public-read';
				}
			} else {
				options.postParams = {
					name: file.name,
					type: getUploadContentType(file),
					size: file.size.toString()
				};

				options.headers = {
					credentials: 'include',
					albumuuid: albumUuid ?? '',
					albumlink: albumLink ?? ''
				};
			}

			await safeStorageUploader({
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

					const message = error?.message ?? 'An unexpected error ocurred';

					setUploads(draft => {
						const upload = draft.findIndex(entry => entry.uuid === uuid);

						// The uploader calls onStart before validating the file, but an
						// error can still arrive for an entry that is not tracked yet.
						if (upload === -1) {
							draft.push({
								uuid,
								name: file.name,
								type: file.type,
								processing: false,
								status: 'error',
								bytesSent: 0,
								bytesTotal: file.size,
								progress: 0,
								url: undefined,
								albumUuid: albumUuid ?? null,
								error: message
							});

							return;
						}

						draft[upload]!.status = 'error';
						draft[upload]!.error = message;
						draft[upload]!.processing = false;
					});

					toast.error(`${file.name}: ${message}`);
				},
				onProgress: (uuid: string, progress: number) => {
					debug(`Progress uploading ${file.name} with uuid ${uuid}`, progress);
					setUploads(draft => {
						const upload = draft.findIndex(u => u.uuid === uuid);
						if (upload !== -1) {
							draft[upload]!.progress = progress;
							draft[upload]!.bytesSent = Math.round((progress / 100) * file.size);
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
								draft[upload]!.progress = 100;
								draft[upload]!.bytesSent = file.size;
							}
						});

						const { error, url } = await processNetworkStorageFile({
							identifier,
							name: file.name,
							type: getUploadContentType(file)
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
							draft[upload]!.progress = 100;
							draft[upload]!.bytesSent = file.size;
						}
					});
					return null;
				}
			});
		},
		[albumLink, albumUuid, currentUser, failUpload, processNetworkStorageFile, setUploads, settings]
	);

	return { failUpload, uploadFile };
};
