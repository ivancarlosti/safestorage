import '@/styles/globals.css';

import type { PropsWithChildren } from 'react';
import type { Viewport } from 'next';
import { cookies } from 'next/headers';
import { Toaster } from 'sonner';

import { fontHeading, fontSans } from '@/lib/fonts';
import { cn } from '@/lib/utils';
import { SettingsProvider } from '@/components/providers/SettingsProvider';
import { TailwindIndicator } from '@/components/tailwind-indicator';
import { UserProvider } from '@/components/providers/UserProvider';

import { Providers } from './providers';
import { GlobalBackground } from '@/components/GlobalBackground';
import request from '@/lib/request';
import { GlobalAdminNotice } from '@/components/GlobalAdminNotice';

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	minimumScale: 1,
	maximumScale: 1,
	themeColor: [
		{ media: '(prefers-color-scheme: light)', color: 'black' },
		{ media: '(prefers-color-scheme: dark)', color: 'black' }
	]
};

const meta = {
	url: 'https://github.com/ivancarlosti/safestorage',
	name: 'safestorage',
	description: 'Beautiful and performant vault to save all your files in the cloud.'
};

export async function generateMetadata() {
	const { data: settings, error } = await request.get({
		url: 'settings',
		options: {
			next: {
				tags: ['settings']
			}
		}
	});

	if (error && process.env.NODE_ENV !== 'production') {
		console.error(error);
	}

	return {
		metadataBase: new URL(settings?.serveUploadsFrom || meta.url),
		title: {
			default: settings?.serviceName ?? meta.name,
			template: `%s - ${settings?.serviceName ?? meta.name}`
		},
		description: settings?.metaDescription ?? meta.description,
		keywords: settings?.metaKeywords.length
			? settings.metaKeywords
			: ['safestorage', 'file uploader', 'vault', 'react', 'free', 'open source'],
		authors: [
			{
				name: 'Ivan Carlos',
				url: 'https://github.com/ivancarlosti'
			}
		],
		creator: 'Ivan Carlos',

		openGraph: {
			type: 'website',
			locale: 'en_US',
			url: settings?.metaDomain ?? meta.url,
			title: settings?.serviceName ?? meta.name,
			description: settings?.metaDescription ?? meta.description,
			siteName: settings?.serviceName ?? meta.name,
			images: [`/og`]
		},
		twitter: {
			card: 'summary_large_image',
			title: settings?.serviceName ?? meta.name,
			description: settings?.metaDescription ?? meta.description,
			images: [`/og`],
			creator: settings?.metaTwitterHandle ?? '@twitter'
		},
		icons: {
			icon: '/favicon.ico',
			shortcut: '/favicon-16x16.png',
			apple: '/apple-touch-icon.png'
		},
		manifest: `/site.webmanifest`
	};
}

export default async function RootLayout({ children }: PropsWithChildren<{}>) {
	const hasTokenCookie = (await cookies()).has('token');

	return (
		<html lang="en" suppressHydrationWarning>
			<head />
			<body
				className={cn(
					'min-h-screen bg-background font-sans antialiased',
					fontSans.variable,
					fontHeading.variable
				)}
			>
				<Providers>
					<GlobalAdminNotice />
					{children}
					<GlobalBackground />
					<Toaster position="bottom-center" />
					<TailwindIndicator />
					<UserProvider shouldFetch={hasTokenCookie} />
					<SettingsProvider />
				</Providers>
			</body>
		</html>
	);
}
