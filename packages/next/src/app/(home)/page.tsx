import { UploadTriggerHomepage } from '@/components/UploadTriggerHomepage';
import { SafeStorageLogo } from '@/components/svg/SafeStorageLogo';
import request from '@/lib/request';

export default async function Home() {
	const { data: settings, error } = await request.get({
		url: 'settings',
		options: {
			next: {
				tags: ['settings']
			}
		}
	});

	// The fallback below already tells the visitor what happened and the
	// backend logs the cause, so this stays a development aid
	if (error && process.env.NODE_ENV !== 'production') {
		console.error(error);
	}

	if (!settings) {
		return (
			<section className="py-2 sm:py-4">
				<div className="container flex min-h-[calc(100vh-15rem)] max-w-[64rem] flex-col text-center place-items-center place-content-evenly gap-4">
					<SafeStorageLogo className="mx-auto mb-4 sm:h-64 sm:w-64 w-32 h-32" />
					<h1 className="font-heading text-2xl sm:text-5xl">Welcome to safestorage</h1>
					<p className="max-w-[42rem] text-muted-foreground">
						Couldn't establish a connection to the server. Please try again later.
					</p>
				</div>
			</section>
		);
	}

	return (
		<section className="py-2 sm:py-4">
			<div className="container flex min-h-[calc(100vh-16rem)] max-w-[64rem] flex-col text-center place-items-center place-content-evenly gap-4">
				<SafeStorageLogo className="mx-auto mb-4 sm:h-64 sm:w-64 w-32 h-32" />
				<h1 className="font-heading text-2xl sm:text-5xl">
					Welcome to {settings.serviceName ?? 'safestorage'}
				</h1>
				<UploadTriggerHomepage settings={settings} />
			</div>
		</section>
	);
}
