'use client';

import { useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { useQueryClient } from '@tanstack/react-query';
import { UploadCloud } from 'lucide-react';
import { uploadsAtom } from '@/lib/atoms/uploads';
import { UploadTrigger } from '@/components/UploadTrigger';
import { UploadProgress } from '@/components/UploadProgress';
import { GlobalDropZone } from '@/components/Dropzone';
import { Button } from '@/components/ui/react-aria-button';
import { buttonVariants } from '@/styles/button';

export const PublicAlbumUploader = ({
	identifier,
	hideFiles
}: {
	readonly hideFiles: boolean;
	readonly identifier: string;
}) => {
	const uploads = useAtomValue(uploadsAtom);
	const queryClient = useQueryClient();

	useEffect(() => {
		const hasSuccess = uploads.some(upload => upload.status === 'success');
		const isUploading = uploads.some(upload => upload.processing);

		if (hasSuccess && !isUploading) {
			void queryClient.invalidateQueries({ queryKey: ['publicAlbumFiles', identifier] });
		}
	}, [identifier, queryClient, uploads]);

	return (
		<>
			<GlobalDropZone albumLink={identifier} />
			<div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-4 sm:p-8 text-center">
				<UploadCloud className="h-8 w-8 text-muted-foreground" />
				<div>
					<p className="font-medium">Drop files here to upload them</p>
					<p className="text-sm text-muted-foreground">
						{hideFiles
							? 'Anyone with this link can upload files. Only you can see what you uploaded.'
							: 'Anyone with this link can upload files to the album.'}
					</p>
				</div>
				<UploadTrigger albumLink={identifier}>
					<Button className={buttonVariants()}>Select files</Button>
				</UploadTrigger>
				<UploadProgress />
			</div>
		</>
	);
};
