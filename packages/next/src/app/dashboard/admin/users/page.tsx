import type { Metadata } from 'next';

import { DashboardHeader } from '@/components/DashboardHeader';
import { UserTable } from '@/components/tables/user-table/UserTable';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import request from '@/lib/request';
import type { PageQuery } from '@/types';
import { Suspense } from 'react';
import { Pagination } from '@/components/Pagination';

export const metadata: Metadata = {
	title: 'Dashboard - Admin - Users'
};

export default async function DashboardAdminUsersPage({ searchParams }: { readonly searchParams: Promise<PageQuery> }) {
	const { page, limit, search = '' } = await searchParams;
	const cookiesStore = await cookies();
	const token = cookiesStore.get('token')?.value;
	if (!token) redirect('/');

	const currentPage = page ?? 1;
	const perPage = limit ? (limit > 50 ? 50 : limit) : 50;

	const authorization = {
		authorization: `Bearer ${token}`
	};

	const {
		data: response,
		error,
		status
	} = await request.get({
		url: `admin/users`,
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
				tags: ['users']
			}
		}
	});

	if (error && status === 401) {
		redirect('/login');
	}

	return (
		<>
			<DashboardHeader
				title="Users"
				subtitle="Manage all users"
				breadcrumbs={[
					{ name: 'Admin', url: '/dashboard/admin' },
					{ name: 'Users', url: '/dashboard/admin/users' }
				]}
			/>
			<div className="px-2 w-full flex flex-col gap-4">
				<Suspense>
					<Pagination itemsTotal={response?.count} />
				</Suspense>
				<UserTable data={response?.users} />
			</div>
		</>
	);
}
