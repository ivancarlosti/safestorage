import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { cn } from '@/lib/utils';
import { LoginForm } from '@/components/auth/LoginForm';
import { KeycloakLoginButton } from '@/components/auth/KeycloakLoginButton';
import { SafeStorageLogo } from '@/components/svg/SafeStorageLogo';
import { buttonVariants } from '@/styles/button';
import request from '@/lib/request';

export const metadata: Metadata = {
	title: 'Login',
	description: 'Login to your account'
};

/*
	The keycloak callback is reached by the browser, so a failure is reported by
	redirecting back here with a `?error=` code instead of a rendered response.
	Only the codes the backend can produce have a message of their own; anything
	else (including the codes keycloak returns itself) falls back to the generic
	one, because leaking an unknown value to the user would be noise.
*/
const KEYCLOAK_ERRORS: Record<string, string> = {
	access_denied: 'The sign-in was cancelled.',
	email_not_verified: 'Your identity provider did not confirm your email address.',
	invalid_request: 'The sign-in request was incomplete, please try again.',
	invalid_state: 'The sign-in request expired, please try again.',
	invalid_token: 'Your identity provider returned an invalid response.',
	not_allowed: 'This email is not allowed to sign in to this instance.',
	server_error: 'Something went wrong while signing you in, please try again.',
	user_disabled: 'This account is disabled.'
};

export default async function LoginPage({ searchParams }: { readonly searchParams: Promise<{ error?: string }> }) {
	const { error } = await searchParams;

	const { data: settings } = await request.get({
		url: 'settings',
		options: {
			next: {
				tags: ['settings']
			}
		}
	});

	// The method decides which of the two forms is shown: the instance either
	// authenticates against local accounts or delegates the whole login to the
	// configured single sign-on provider.
	const keycloakMethod = settings?.authMethod === 'keycloak';
	const errorMessage = error ? KEYCLOAK_ERRORS[error] ?? 'The sign-in failed, please try again.' : null;

	return (
		<div className="container flex h-screen w-screen flex-col items-center justify-center">
			<Link
				href="/"
				className={cn(buttonVariants({ variant: 'ghost' }), 'absolute left-4 top-4 md:left-8 md:top-8')}
			>
				<span className="flex items-center flex-row">
					<ChevronLeft className="mr-2 h-4 w-4" /> Back
				</span>
			</Link>
			<div className="mx-auto flex w-full flex-col justify-center gap-6 sm:w-[350px]">
				<div className="flex flex-col gap-2 text-center">
					<SafeStorageLogo className="mx-auto mb-4 h-64 w-64" />
					<h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
					<p className="text-sm text-muted-foreground">
						{keycloakMethod
							? 'Sign in with the account provided by your organization'
							: 'Enter your email to sign in to your account'}
					</p>
				</div>

				{errorMessage ? (
					<p className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-center text-sm text-destructive">
						{errorMessage}
					</p>
				) : null}

				{keycloakMethod ? <KeycloakLoginButton /> : <LoginForm recaptchaSiteKey={settings?.recaptchaSiteKey} />}

				{keycloakMethod ? null : (
					<p className="px-8 text-center text-sm text-muted-foreground">
						<Link href="/register" className="hover:text-brand underline underline-offset-4">
							Don&apos;t have an account? Sign Up
						</Link>
					</p>
				)}
			</div>
		</div>
	);
}

