import { cn } from '@/lib/utils';
import { buttonVariants } from '@/styles/button';

/*
	The single sign-on flow starts on the backend (`/api/auth/keycloak/login`),
	which answers with a redirect to the identity provider, so this is deliberately
	a plain anchor instead of a `next/link`: the browser has to leave the app, and
	the router would try to fetch the endpoint in the background instead.

	A relative path works in both deployments: nginx proxies `/api/` in the
	container and `next.config.mjs` rewrites it to `BASE_API_URL` in development.
*/
export const KeycloakLoginButton = () => (
	<a href="/api/auth/keycloak/login" className={cn(buttonVariants(), 'w-full')}>
		Sign in with single sign-on
	</a>
);
