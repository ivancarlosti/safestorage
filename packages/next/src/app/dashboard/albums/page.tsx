import type { Metadata } from 'next';

import type { PageQuery } from '@/types';
import { DashboardHeader } from '@/components/DashboardHeader';
import { AlbumSettingsDialog } from '@/components/dialogs/AlbumSettingsDialog';
import { CreateAlbumDialog } from '@/components/dialogs/CreateAlbumDialog';
import { Suspense } from 'react';
import { AlbumPage } from './AlbumPage';
import { CreateAlbumDrawer } from '@/components/drawers/CreateAlbumDrawer';

export const metadata: Metadata = {
	title: 'Dashboard - Albums'
};

export default async function AlbumsPage({ searchParams }: { readonly searchParams: Promise<PageQuery> }) {
	const { page, limit, search = '' } = await searchParams;
	const currentPage = page ?? 1;
	const perPage = limit ? (limit > 50 ? 50 : limit) : 50;

	return (
		<>
			<DashboardHeader title="Albums" subtitle="Manage and create albums">
				<CreateAlbumDialog className="hidden md:inline-flex" />
				<CreateAlbumDrawer className="inline-flex md:hidden" />
			</DashboardHeader>
			<div className="grid gap-8 w-full px-2">
				<Suspense fallback="Loading...">
					<AlbumPage page={currentPage} limit={perPage} search={search} />
				</Suspense>
			</div>
			<AlbumSettingsDialog />
		</>
	);
}
