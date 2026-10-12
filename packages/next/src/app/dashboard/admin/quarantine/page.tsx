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
	title: 'Dashboard - Admin - Quarantine'
};

export default async function DashboardAdminQuarantinePage({
	searchParams
}: {
	readonly searchParams: Promise<PageQuery>;
}) {
	const { page, limit, search = '' } = await searchParams;
	const currentPage = page ?? 1;
	const perPage = limit ? (limit > 50 ? 50 : limit) : 50;

	const { data: response, error, status } = await fetchEndpoint({ type: 'quarantine' }, currentPage, perPage, search);
	if (error && status === 401) {
		redirect('/login');
	}

	return (
		<>
			<DashboardHeader
				title="Quarantined files"
				subtitle="Manage quarantined files"
				breadcrumbs={[
					{ name: 'Admin', url: '/dashboard/admin' },
					{ name: 'Quarantined files', url: '/dashboard/admin/quarantine' }
				]}
			/>
			<div className="px-2 w-full">
				<div className="grid gap-4">
					<Suspense>
						<Pagination itemsTotal={response.count} type="quarantine" />
						<FilesWrapper files={response.files} total={response.count} type="quarantine" />
						<Pagination itemsTotal={response.count} type="quarantine" />
					</Suspense>
					<FileDialog />
				</div>
			</div>
		</>
	);
}
