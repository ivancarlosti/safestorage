import type { Metadata } from 'next';
import type { PageQuery } from '@/types';

import { fetchEndpoint } from '@/lib/fileFetching';
import { DashboardHeader } from '@/components/DashboardHeader';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Pagination } from '@/components/Pagination';
import { FilesWrapper } from '@/components/FilesWrapper';
import { FileDialog } from '@/components/dialogs/FileDialog';

export const metadata: Metadata = {
	title: 'Dashboard - Admin - Files'
};

export default async function AdminFilesPage({ searchParams }: { readonly searchParams: Promise<PageQuery> }) {
	const { page, limit, search = '', publicOnly = false } = await searchParams;
	const currentPage = page ?? 1;
	const perPage = limit ? (limit > 50 ? 50 : limit) : 50;

	const {
		data: response,
		error,
		status
	} = await fetchEndpoint({ type: 'admin' }, currentPage, perPage, search, publicOnly);
	if (error && status === 401) {
		redirect('/login');
	}

	return (
		<>
			<DashboardHeader
				title="Everyone's files"
				subtitle="Manage all of safestorage files, no matter who owns them."
				breadcrumbs={[
					{ name: 'Admin', url: '/dashboard/admin' },
					{ name: 'All files', url: '/dashboard/admin/files' }
				]}
			/>
			<div className="px-2 w-full">
				<div className="grid gap-4">
					<Suspense>
						<Pagination itemsTotal={response.count} type="admin" />
						<FilesWrapper files={response.files} type="admin" />
						<Pagination itemsTotal={response.count} type="admin" />
					</Suspense>
					<FileDialog />
				</div>
			</div>
		</>
	);
}
