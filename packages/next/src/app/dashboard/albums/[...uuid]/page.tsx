import type { Metadata } from 'next';
import type { PageQuery } from '@/types';
import { FolderUp, Plus } from 'lucide-react';

import { fetchEndpoint } from '@/lib/fileFetching';
import { Button } from '@/components/ui/react-aria-button';
import { DashboardHeader } from '@/components/DashboardHeader';
import { GlobalDropZone } from '@/components/Dropzone';
import { UploadTrigger } from '@/components/UploadTrigger';
import { AlbumShareDialog } from '@/components/dialogs/AlbumShareDialog';
import { buttonVariants } from '@/styles/button';
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Pagination } from '@/components/Pagination';
import { FilesWrapper } from '@/components/FilesWrapper';
import { FileDialog } from '@/components/dialogs/FileDialog';
import { AlbumViewModeSync } from '@/components/AlbumViewModeSync';

export const metadata: Metadata = {
	title: 'Dashboard - Albums'
};

export default async function AlbumPage({
	searchParams,
	params
}: {
	readonly params: Promise<{ uuid: string }>;
	readonly searchParams: Promise<PageQuery>;
}) {
	const { uuid } = await params;
	const { page, limit, search = '' } = await searchParams;
	const currentPage = page ?? 1;
	const perPage = limit ? (limit > 50 ? 50 : limit) : 50;

	const {
		data: response,
		error,
		status
	} = await fetchEndpoint({ type: 'album', albumUuid: uuid }, currentPage, perPage);
	if (error && status === 401) {
		redirect('/login');
	}

	const queryClient = new QueryClient();

	await queryClient.prefetchQuery({
		queryKey: ['album', uuid, { currentPage, perPage, search }],
		queryFn: async () => {
			const { data: response } = await fetchEndpoint(
				{ type: 'album', albumUuid: uuid },
				currentPage,
				perPage,
				search
			);
			return response;
		}
	});

	return (
		<>
			<DashboardHeader
				title={response.name}
				subtitle={response.description}
				breadcrumbs={[
					{ name: 'Albums', url: '/dashboard/albums' },
					{ name: response.name, url: `/dashboard/albums/${uuid}` }
				]}
			>
				{response.isOwner === false ? (
					<span className="hidden text-sm text-muted-foreground md:inline">
						Shared by {response.ownerUsername}
					</span>
				) : null}
				{/*
					A website album keeps the structure of the site it serves, so the
					folder it is stored in is shown: it is what an `rsync`/`rclone`
					mirror of the instance has to write to.
				*/}
				{response.isWebsite && response.siteIdentifier ? (
					<span className="hidden text-sm text-muted-foreground md:inline">
						Website files live in <code className="font-mono">site/{response.siteIdentifier}/</code>
					</span>
				) : null}
				{response.isOwner === false ? null : <AlbumShareDialog albumName={response.name} albumUuid={uuid} />}
				<UploadTrigger allowsMultiple albumUuid={uuid}>
					<Button className={buttonVariants()}>
						<Plus className="mr-2 h-4 w-4" />
						Upload file to album
					</Button>
				</UploadTrigger>
				{response.isWebsite ? (
					// Picks a whole folder, keeping every relative path: `css/app.css`
					// is stored and served as `css/app.css`
					<UploadTrigger acceptDirectory allowsMultiple albumUuid={uuid}>
						<Button className={buttonVariants({ variant: 'secondary' })}>
							<FolderUp className="mr-2 h-4 w-4" />
							Upload folder
						</Button>
					</UploadTrigger>
				) : null}
			</DashboardHeader>
			<div className="px-2 w-full">
				<HydrationBoundary state={dehydrate(queryClient)}>
					<div className="grid gap-4">
						<Suspense>
							{/* Rendered inside the boundary so the file list is mounted before the mode is applied. */}
							<AlbumViewModeSync viewMode={response.viewMode ?? 'thumbs'} />
							<Pagination type="album" albumUuid={uuid} />
							<FilesWrapper type="album" albumUuid={uuid} />
							<Pagination type="album" albumUuid={uuid} />
						</Suspense>
						<FileDialog />
					</div>
				</HydrationBoundary>
			</div>
			<GlobalDropZone albumUuid={uuid} />
		</>
	);
}
