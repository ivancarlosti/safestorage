'use client';

export interface MultipartUploadTarget {
	partSize: number;
	parts: { partNumber: number; url: string }[];
	uploadId: string;
}

// Parts are uploaded a few at a time to keep the connection busy without
// flooding it, and a failed part is retried before giving up on the upload.
const maximumConcurrentParts = 2;
const partAttempts = 3;
const retryDelay = 3000;

const putPart = async (url: string, part: Blob, onUploaded: (bytes: number) => void) =>
	new Promise<void>((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open('PUT', url);

		request.upload.addEventListener('progress', event => {
			if (event.lengthComputable) {
				onUploaded(event.loaded);
			}
		});

		request.addEventListener('load', () => {
			if (request.status >= 200 && request.status < 300) {
				onUploaded(part.size);
				resolve();
				return;
			}

			reject(new Error(`Uploading a part failed with status ${request.status}`));
		});
		request.addEventListener('error', () => reject(new Error('Uploading a part failed, check your connection')));
		request.addEventListener('abort', () => reject(new Error('Uploading a part was aborted')));

		request.send(part);
	});

const putPartWithRetries = async (upload: () => Promise<void>, partNumber: number) => {
	let lastError = new Error('Uploading a part failed');

	for (let attempt = 1; attempt <= partAttempts; attempt++) {
		try {
			// eslint-disable-next-line no-await-in-loop
			await upload();
			return;
		} catch (error: any) {
			lastError = error as Error;

			if (attempt < partAttempts) {
				// eslint-disable-next-line no-await-in-loop
				await new Promise<void>(resolve => {
					setTimeout(resolve, retryDelay);
				});
			}
		}
	}

	throw new Error(`Uploading part ${partNumber} failed after ${partAttempts} attempts: ${lastError.message}`);
};

/*
	Uploads a file to a S3 compatible network storage with a multipart upload.
	Every part is sent to its own pre-signed URL, so a part that fails can be
	retried without restarting the whole transfer, and the upload is not limited
	by the 5 GB ceiling of a single PUT request.
*/
export const uploadFileInParts = async ({
	file,
	target,
	onProgress
}: {
	file: File;
	onProgress?: ((bytesSent: number, progress: number) => void) | undefined;
	target: MultipartUploadTarget;
}) => {
	const parts = target.parts;
	if (!parts.length) throw new Error('The upload has no parts to send');

	// Bytes reported per part, so retried parts are not counted twice
	const uploadedBytes = Array.from({ length: parts.length }, () => 0);
	const reportProgress = (index: number, bytes: number) => {
		uploadedBytes[index] = Math.min(bytes, file.size);
		const bytesSent = uploadedBytes.reduce((total, value) => total + value, 0);
		onProgress?.(bytesSent, Math.min(100, Math.round((bytesSent / file.size) * 100)));
	};

	let nextPart = 0;
	const uploadNextParts = async () => {
		for (;;) {
			const index = nextPart++;
			const part = parts[index];
			if (!part) return;

			const start = (part.partNumber - 1) * target.partSize;
			const chunk = file.slice(start, Math.min(start + target.partSize, file.size));

			// eslint-disable-next-line no-await-in-loop
			await putPartWithRetries(
				async () => putPart(part.url, chunk, bytes => reportProgress(index, bytes)),
				part.partNumber
			);
			reportProgress(index, chunk.size);
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(maximumConcurrentParts, parts.length) }, async () => uploadNextParts())
	);
};
