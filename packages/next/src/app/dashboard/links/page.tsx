import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { DashboardHeader } from '@/components/DashboardHeader';
import { CreateShortUrlDialog } from '@/components/dialogs/CreateShortUrlDialog';
import { CreateShortUrlDrawer } from '@/components/drawers/CreateShortUrlDrawer';
import { Callout } from '@/components/mdx/Callout';

export const metadata: Metadata = {
	title: 'Dashboard - Short URLs'
};

export default async function DashboardLinksPage() {
	const cookiesStore = await cookies();
	const token = cookiesStore.get('token')?.value;
	if (!token) redirect('/');

	return (
		<>
			<DashboardHeader title="Short URLs" subtitle="Create short URLs on the configured YOURLS instance">
				<CreateShortUrlDialog className="hidden md:inline-flex" />
				<CreateShortUrlDrawer className="inline-flex md:hidden" />
			</DashboardHeader>
			<div className="px-2 w-full">
				<Callout type="default" icon="🔗">
					<p className="text-sm">
						Short URLs are created and stored on the YOURLS instance configured by the administrator, so
						they keep working even when this service is unreachable. That also means the links are managed
						in the YOURLS admin area, not here: this page only creates them, so copy the link right after it
						is created.
					</p>
				</Callout>
			</div>
		</>
	);
}
