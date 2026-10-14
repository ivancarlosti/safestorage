import request from '@/lib/request';

export const SafeStorageDefaultLogo = ({
	className = '',
	width = '128px',
	height = '128px'
}: {
	readonly className?: string;
	readonly height?: string | undefined;
	readonly width?: string | undefined;
}) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width={width}
		height={height}
		viewBox="0 0 128 128"
		className={className}
		role="img"
		aria-label="safestorage"
	>
		<title>safestorage</title>
		<path
			fill="#2563eb"
			d="M33 7H95A26 26 0 0 1 121 33V95A26 26 0 0 1 95 121H33A26 26 0 0 1 7 95V33A26 26 0 0 1 33 7Z"
		/>
		<path
			fill="#ffffff"
			d="M59.9 34.38Q64 30 68.1 34.38L89.9 57.62Q94 62 88 62L81 62Q75 62 75 68L75 88Q75 94 69 94L59 94Q53 94 53 88L53 68Q53 62 47 62L40 62Q34 62 38.1 57.62Z"
		/>
	</svg>
);

export const SafeStorageLogo = async ({ className = '' }: { readonly className?: string }) => {
	const { data, error } = await request.get({
		url: 'settings',
		options: {
			next: {
				tags: ['settings']
			}
		}
	});

	if (error) {
		return <SafeStorageDefaultLogo className={className} />;
	}

	if (data?.logoURL) {
		return (
			<picture>
				<img src={data.logoURL} alt="safestorage" className={className} />
			</picture>
		);
	}

	return <SafeStorageDefaultLogo className={className} />;
};
