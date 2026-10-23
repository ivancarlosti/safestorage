import { Navigation } from '@/components/Navigation';
import { NavigationUser } from '@/components/NavigationUser';
import { GitHubLogo } from '@/components/svg/GitHubLogo';
import { UploadProgress } from '@/components/UploadProgress';
import { buttonVariants } from '@/styles/button';
import { SafeStorageLogo } from './svg/SafeStorageLogo';
import request from '@/lib/request';

export const Header = async () => {
	const { data } = await request.get({
		url: 'settings',
		options: {
			next: {
				tags: ['settings']
			}
		}
	});

	return (
		<header className="container z-40">
			<div className="flex h-16 sm:h-20 place-content-between place-items-center">
				<Navigation
					logo={<SafeStorageLogo className="w-6 h-6" />}
					serviceName={data?.serviceName}
					showDocsMenu={data?.showDocsMenu !== false}
					showGuidesMenu={data?.showGuidesMenu !== false}
					showFaqMenu={data?.showFaqMenu !== false}
				/>
				<UploadProgress />
				<nav className="flex items-center gap-1">
					{data?.showGithubIcon === false ? null : (
						<a href="https://github.com/ivancarlosti/safestorage" target="_blank" rel="noopener noreferrer">
							<div
								className={buttonVariants({
									size: 'icon',
									variant: 'ghost'
								})}
							>
								<GitHubLogo className="h-6 w-6" />
								<span className="sr-only">GitHub</span>
							</div>
						</a>
					)}
					<div className="hidden md:inline-flex ml-4">
						<NavigationUser />
					</div>
				</nav>
			</div>
		</header>
	);
};
