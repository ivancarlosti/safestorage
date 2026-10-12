import type { Metadata } from 'next';

import { DashboardHeader } from '@/components/DashboardHeader';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import request from '@/lib/request';
import { TagsTable } from '@/components/tables/tags-table/TagsTable';
import { CreateTagDialog } from '@/components/dialogs/CreateTagDialog';
import type { PageQuery } from '@/types';
import { Suspense } from 'react';
import { Pagination } from '@/components/Pagination';
import { CreateTagDrawer } from '@/components/drawers/CreateTagDrawer';

export const metadata: Metadata = {
	title: 'Dashboard - Admin - Tags'
};

export default async function DashboardTagsPage({ searchParams }: { readonly searchParams: Promise<PageQuery> }) {
	const { page, limit, search = '' } = await searchParams;
	const cookiesStore = await cookies();
	const token = cookiesStore.get('token')?.value;
	if (!token) redirect('/');

	const authorization = {
		authorization: `Bearer ${token}`
	};

	const currentPage = page ?? 1;
	const perPage = limit ? (limit > 50 ? 50 : limit) : 50;

	const {
		data: response,
		error,
		status
	} = await request.get({
		url: `tags`,
		query: {
			page: currentPage,
			limit: perPage,
			search
		},
		headers: {
			...authorization
		},
		options: {
			next: {
				tags: ['tags']
			}
		}
	});

	if (error && status === 401) {
		redirect('/login');
	}

	return (
		<>
			<DashboardHeader title="Tags" subtitle="Manage and create tags">
				<CreateTagDialog className="hidden md:inline-flex" />
				<CreateTagDrawer className="inline-flex md:hidden" />
			</DashboardHeader>
			<div className="px-2 w-full flex flex-col gap-4">
				<Suspense>
					<Pagination itemsTotal={response?.count} />
				</Suspense>
				<TagsTable data={response?.tags} />
			</div>
		</>
	);
}
