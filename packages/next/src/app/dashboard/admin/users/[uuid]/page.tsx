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
	title: 'Dashboard - Admin - User'
};

export default async function DashboardAdminUserPage({
	params,
	searchParams
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
	} = await fetchEndpoint({ type: 'admin', userUuid: uuid }, currentPage, perPage, search);
	if (error && status === 401) {
		redirect('/login');
	}

	const username = response.user?.username;
	return (
		<>
			<DashboardHeader
				title={`${username}'s files`}
				subtitle="As an admin, you can manage their files"
				breadcrumbs={[
					{ name: 'Admin', url: '/dashboard/admin' },
					{ name: 'Users', url: '/dashboard/admin/users' },
					{ name: username, url: `/dashboard/admin/users/${uuid}` }
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
