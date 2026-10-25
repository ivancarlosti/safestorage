import type { PropsWithChildren } from 'react';

import { SiteFooter } from '@/components/Footer';

export default async function PublicAlbumsLayout({ children }: PropsWithChildren) {
	return (
		<div className="flex min-h-screen flex-col">
			<div className="container flex flex-grow flex-col gap-4 px-2 py-4 sm:gap-6 sm:px-8 sm:py-8">{children}</div>
			<SiteFooter className="border-t" />
		</div>
	);
}
