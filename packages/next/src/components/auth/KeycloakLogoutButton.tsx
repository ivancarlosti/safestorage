import { cn } from '@/lib/utils';
import { buttonVariants } from '@/styles/button';

/*
	Ends both the local session and the one at the identity provider, so the next
	sign-in can use another account instead of silently reusing the previous one.

	Like the login button this is a plain anchor: the backend answers with a
	redirect to the provider (and back to `/login`), so the browser has to leave
	the app and `next/link` would try to prefetch the endpoint instead.
*/
export const KeycloakLogoutButton = ({ className = '' }: { readonly className?: string | undefined }) => (
	<a
		href="/api/auth/keycloak/logout"
		className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'w-full', className)}
	>
		Log out and try another account
	</a>
);
