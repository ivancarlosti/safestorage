import type { Metadata } from 'next';

import { DashboardHeader } from '@/components/DashboardHeader';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ChangePassword } from '@/components/ChangePassword';
import { RegenerateApiKey } from '@/components/RegenerateApiKey';
import request from '@/lib/request';
import { cookies } from 'next/headers';
import type { LocalStorageUser, StorageQuota } from '@/types';
import { formatBytes } from '@/lib/file';
import { CategoryBar } from '@/components/Statistics';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
	title: 'Dashboard - Credentials'
};

export default async function DashboardPage() {
	const cookiesStore = await cookies();
	const token = cookiesStore.get('token')?.value;

	const {
		data: response,
		error,
		status
	} = await request.get({
		url: `user/me`,
		headers: {
			Authorization: `Bearer ${token}`
		},
		options: {
			next: {
				tags: ['me']
			}
		}
	});

	if (error && status === 401) {
		redirect('/login');
	}

	/*
		A keycloak deployment never stores a password for its users, so the local
		form would only ever be rejected by the API: the settings say which method
		is active and therefore whether the section belongs on the page.
	*/
	const { data: settings } = await request.get({
		url: 'settings',
		options: {
			next: {
				tags: ['settings']
			}
		}
	});

	const passwordChangeEnabled = settings?.authMethod !== 'keycloak';

	const user = response?.user as LocalStorageUser;
	const quota = response?.storageQuota as StorageQuota;

	return (
		<>
			<DashboardHeader
				title="Credentials"
				subtitle="Manage your credentials"
				breadcrumbs={[{ name: 'Credentials', url: '/dashboard/account' }]}
			/>
			<div className="px-2 w-full">
				<div className="flex flex-col lg:flex-row gap-8">
					<div className="flex flex-col gap-2 lg:w-2/4">
						<div className="flex flex-col gap-1">
							<Label htmlFor="username">Your username</Label>
							<Input name="username" id="username" value={user?.username} readOnly />
							<p className="text-[0.8rem] text-muted-foreground">
								Can't be changed, only for display purposes
							</p>
						</div>

						{passwordChangeEnabled ? (
							<>
								<Separator className="my-4" />

								<ChangePassword />
							</>
						) : null}
					</div>
					<div className="flex flex-col w-full">
						<RegenerateApiKey apiKey={user?.apiKey} />
						<Separator className="my-4" />
						{quota ? (
							<>
								<span className="text-light-100">Storage quota</span>
								<span className="text-light-100 flex flex-col gap-2">
									<CategoryBar
										values={[40, 30, 20, 10]}
										colors={['emerald', 'yellow', 'orange', 'rose']}
										markerValue={quota.quota ? (quota.used / quota.quota) * 100 : 0}
									/>
									<p className="text-[0.8rem] text-muted-foreground">
										Using {formatBytes(quota.used)} of{' '}
										{quota.quota ? formatBytes(quota.quota) : 'unlimited'}
									</p>
								</span>
							</>
						) : null}
					</div>
				</div>
			</div>
		</>
	);
}
