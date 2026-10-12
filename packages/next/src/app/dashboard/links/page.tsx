import type { Metadata } from 'next';

import { DashboardHeader } from '@/components/DashboardHeader';
import { cookies } from 'next/headers';
import request from '@/lib/request';
import type { PageQuery } from '@/types';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Pagination } from '@/components/Pagination';
import { LinksTable } from '@/components/tables/links-table/LinksTable';
import { CreateShortUrlDialog } from '@/components/dialogs/CreateShortUrlDialog';
import { CreateShortUrlDrawer } from '@/components/drawers/CreateShortUrlDrawer';

export const metadata: Metadata = {
	title: 'Dashboard - Short URLs'
};

export default async function DashboardLinksPage({ searchParams }: { readonly searchParams: Promise<PageQuery> }) {
	const { page, limit, search = '' } = await searchParams;
	const cookiesStore = await cookies();
	const token = cookiesStore.get('token')?.value;
	if (!token) redirect('/');

	const currentPage = page ?? 1;
	const perPage = limit ? (limit > 50 ? 50 : limit) : 50;

	const {
		data: response,
		error,
		status
	} = await request.get({
		url: `links`,
		query: {
			page: currentPage,
			limit: perPage,
			search
		},
		headers: {
			authorization: `Bearer ${token}`
		},
		options: {
			next: {
				tags: ['links']
			}
		}
	});

	if (error && status === 401) {
		redirect('/login');
	}

	return (
		<>
			<DashboardHeader title="Short URLs" subtitle="Manage and create short URLs">
				<CreateShortUrlDialog className="hidden md:inline-flex" />
				<CreateShortUrlDrawer className="inline-flex md:hidden" />
			</DashboardHeader>
			<div className="px-2 w-full flex flex-col gap-4">
				<Suspense>
					<Pagination itemsTotal={response?.count} />
				</Suspense>
				<LinksTable data={response?.links} />
			</div>
		</>
	);
}
