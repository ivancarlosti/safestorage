'use client';

import { useState } from 'react';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';
import request from '@/lib/request';

const getFileName = (disposition: string | null) => {
	if (!disposition) return 'album.zip';

	const encodedMatch = /filename\*=UTF-8''(?<name>[^;]+)/i.exec(disposition);
	if (encodedMatch?.groups?.name) {
		try {
			return decodeURIComponent(encodedMatch.groups.name);
		} catch {
			// Fall back to the plain filename below
		}
	}

	const plainMatch = /filename="(?<name>[^"]+)"/i.exec(disposition);
	return plainMatch?.groups?.name ?? 'album.zip';
};

export const BulkDownloadZipAction = ({
	albumUuid,
	uuids
}: {
	readonly albumUuid: string;
	readonly uuids: string[];
}) => {
	const [isPending, setIsPending] = useState(false);

	const download = async () => {
		setIsPending(true);

		try {
			const { data, error } = await request.raw({
				method: 'POST',
				url: `album/${albumUuid}/zip`,
				options: {
					body: JSON.stringify({ files: uuids })
				}
			});

			if (error || !data) {
				toast.error(error ?? 'There was a problem creating the ZIP archive');
				return;
			}

			const blob = await data.blob();
			saveAs(blob, getFileName(data.headers.get('content-disposition')));
			toast.success(`Downloaded ${uuids.length} ${uuids.length > 1 ? 'files' : 'file'} as ZIP`);
		} catch (error: any) {
			toast.error(error?.message ?? 'There was a problem creating the ZIP archive');
		} finally {
			setIsPending(false);
		}
	};

	return (
		<button
			type="submit"
			className="w-full h-full flex px-2 py-1.5 cursor-default"
			disabled={isPending}
			onClick={() => void download()}
		>
			{isPending ? 'Preparing ZIP...' : `Download ${uuids.length} ${uuids.length > 1 ? 'files' : 'file'} as ZIP`}
		</button>
	);
};
