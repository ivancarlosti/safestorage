'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { settingsAtom } from '@/lib/atoms/settings';
import { useAtomValue } from 'jotai';
import { NavigationDrawer } from './NavigationDrawer';

export function Navigation({
	logo,
	serviceName = '',
	authMethod,
	showDocsMenu = true,
	showGuidesMenu = true,
	showFaqMenu = true
}: {
	readonly logo: ReactNode;
	readonly serviceName?: string | undefined;
	readonly authMethod?: 'account' | 'keycloak' | undefined;
	readonly showDocsMenu?: boolean | undefined;
	readonly showGuidesMenu?: boolean | undefined;
	readonly showFaqMenu?: boolean | undefined;
}) {
	const path = usePathname();
	const settings = useAtomValue(settingsAtom);

	// The settings atom is refreshed right after the admin saves the form, so the
	// menu reacts without waiting for the server component to be rendered again.
	const docsMenuVisible = settings?.showDocsMenu ?? showDocsMenu;
	const guidesMenuVisible = settings?.showGuidesMenu ?? showGuidesMenu;
	const faqMenuVisible = settings?.showFaqMenu ?? showFaqMenu;

	return (
		<div className="flex gap-6">
			<Link href="/" className="hidden items-center md:flex gap-4">
				{logo}
				<span className="hidden font-bold sm:inline-block">{settings?.serviceName ?? serviceName}</span>
			</Link>
			<nav className="hidden gap-6 md:flex">
				<Link
					href="/dashboard"
					className="flex items-center text-lg font-medium transition-colors hover:text-foreground/80 sm:text-sm text-foreground/60"
				>
					Dashboard
				</Link>
				{docsMenuVisible ? (
					<a
						href="/docs"
						rel="noopener noreferrer"
						className="flex items-center text-lg font-medium transition-colors hover:text-foreground/80 sm:text-sm text-foreground/60"
					>
						Docs
					</a>
				) : null}
				{guidesMenuVisible ? (
					<a
						href="https://github.com/ivancarlosti/safestorage/tree/main/docs"
						rel="noopener noreferrer"
						className={cn(
							'flex items-center text-lg font-medium transition-colors hover:text-foreground/80 sm:text-sm text-foreground/60'
						)}
					>
						Guides
					</a>
				) : null}
				{faqMenuVisible ? (
					<Link
						href="/faq"
						className={cn(
							'flex items-center text-lg font-medium transition-colors hover:text-foreground/80 sm:text-sm',
							path === '/faq' ? 'text-foreground' : 'text-foreground/60'
						)}
					>
						FAQ
					</Link>
				) : null}
			</nav>
			<NavigationDrawer
				logo={logo}
				className="md:hidden flex"
				authMethod={authMethod}
				showDocsMenu={docsMenuVisible}
				showFaqMenu={faqMenuVisible}
			/>
		</div>
	);
}
