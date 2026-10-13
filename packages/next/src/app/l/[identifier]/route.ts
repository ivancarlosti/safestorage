import request from '@/lib/request';
import { redirect } from 'next/navigation';

export async function GET(_: Request, { params }: { params: Promise<{ identifier: string }> }) {
	const { identifier } = await params;
	if (!identifier) {
		return redirect('/404');
	}

	(async () => {
		try {
			await request.get({
				url: `link/${encodeURIComponent(identifier)}/count`,
				options: {
					cache: 'no-cache'
				}
			});
		} catch (error) {
			if (process.env.NODE_ENV !== 'production') console.error('Failed to update link view count', error);
		}
	})();

	redirect(`/api/link/${encodeURIComponent(identifier)}`);
}
