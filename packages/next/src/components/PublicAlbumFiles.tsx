'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import type { File, ViewMode } from '@/types';
import request from '@/lib/request';
import { FilesWrapper } from '@/components/FilesWrapper';
import { Pagination } from '@/components/Pagination';

interface PublicAlbumResponse {
	album: {
		allowUploads: boolean;
		count: number;
		files: File[];
		hideFiles: boolean;
		viewMode: ViewMode;
	};
}

/*
	The public album is fetched from the browser so that the backend sees the
	visitor's IP. That is what makes a drop-only link show just the files that
	visitor uploaded, instead of the files uploaded by the Next.js server.
*/
export const PublicAlbumFiles = ({
	identifier,
	initialResponse,
	hideFiles
}: {
	readonly hideFiles: boolean;
	readonly identifier: string;
	readonly initialResponse: PublicAlbumResponse;
}) => {
	const searchParams = useSearchParams();
	const currentPage = searchParams.get('page') ? Number.parseInt(searchParams.get('page')!, 10) : 1;
	const perPage = searchParams.get('limit')
		? Number.parseInt(searchParams.get('limit')!, 10) > 50
			? 50
			: Number.parseInt(searchParams.get('limit')!, 10)
		: 50;
	const search = searchParams.get('search') ?? '';

	const { data } = useQuery<PublicAlbumResponse>({
		queryKey: ['publicAlbumFiles', identifier, { currentPage, perPage, search }],
		...(hideFiles || currentPage !== 1 || search ? {} : { initialData: initialResponse }),
		// A drop-only album has to refetch on mount: the server-rendered response
		// belongs to the server's IP, not to the visitor.
		staleTime: 0,
		queryFn: async () => {
			const { data: response, error } = await request.get({
				url: `album/${identifier}/view`,
				query: {
					page: currentPage,
					limit: perPage,
					search
				},
				headers: hideFiles ? { 'x-album-visitor': '1' } : {},
				options: {
					cache: 'no-store'
				}
			});

			if (error) throw new Error(error);
			return response as PublicAlbumResponse;
		}
	});

	/*
		While a drop-only album is loading, show an empty list instead of the
		server-rendered one: the server cannot know which files belong to this
		visitor, and showing its response could leak another visitor's uploads.
	*/
	const album =
		data?.album ?? (hideFiles ? { ...initialResponse.album, count: 0, files: [] } : initialResponse.album);

	return (
		<>
			<Pagination itemsTotal={album.count} type="publicAlbum" />
			<FilesWrapper files={album.files} type="publicAlbum" />
			<Pagination itemsTotal={album.count} type="publicAlbum" />
		</>
	);
};
