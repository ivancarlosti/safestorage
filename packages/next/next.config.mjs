import { readFileSync } from 'node:fs';

/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	output: 'standalone',
	pageExtensions: ['ts', 'tsx'],
	env: {
		NEXT_PUBLIC_VERSION: JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
	},
	logging: {
		fetches: {
			fullUrl: true
		}
	},
	images: {
		// TODO: Enable from anywhere or find a better way to configure it
		// this is used to be able to use <Image> with external URLs
		remotePatterns: [
			{
				protocol: 'http',
				hostname: 'localhost'
			}
		]
	},
	async rewrites() {
		return process.env.NODE_ENV === 'production'
			? []
			: [
					{
						source: '/api/:path*',
						destination: `${process.env.BASE_API_URL}/api/:path*`
					}
				];
	},
	eslint: {
		ignoreDuringBuilds: true
	},
	typescript: {
		ignoreBuildErrors: true
	}
};

export default nextConfig;
