'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSetAtom } from 'jotai';
import { Loader2 } from 'lucide-react';
import { currentUserAtom } from '@/lib/atoms/currentUser';
import { cn, debug } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buttonVariants } from '@/styles/button';
import request from '@/lib/request';
import { toast } from 'sonner';
import { ReCaptcha, type ReCaptchaHandle } from './ReCaptcha';

export const LoginForm = ({ recaptchaSiteKey }: { readonly recaptchaSiteKey?: string | undefined }) => {
	const router = useRouter();
	const [isLoading, setIsLoading] = useState<boolean>(false);
	const [recaptchaToken, setRecaptchaToken] = useState<string>('');
	const recaptchaRef = useRef<ReCaptchaHandle>(null);
	const setCurrentUser = useSetAtom(currentUserAtom);

	// The API only exposes a site key when the instance configured both halves of
	// the captcha, so its presence is what turns the widget on.
	const recaptchaEnabled = Boolean(recaptchaSiteKey);

	async function onSubmit(data: FormData) {
		setIsLoading(true);

		try {
			const { data: response, error } = await request.post({
				url: 'auth/login',
				body: {
					email: data.get('email') as string,
					password: data.get('password') as string,
					recaptchaToken
				}
			});

			if (error) {
				toast.error(error);
				return;
			}

			setCurrentUser(response.user);

			router.push('/dashboard');
		} catch (error: any) {
			toast.error(error);
			// The caught value can hold the request that was sent (form body
			// included), so only its message is ever printed
			debug('Login failed', error instanceof Error ? error.message : error);
		} finally {
			setIsLoading(false);
			// The token that was just sent is spent, whether the login succeeded or
			// not, so the checkbox goes back to its initial state.
			recaptchaRef.current?.reset();
		}
	}

	return (
		<div className={cn('grid gap-6')}>
			<form action={onSubmit}>
				<div className="grid gap-2">
					<div className="grid gap-1">
						<Label className="sr-only" htmlFor="email">
							Email
						</Label>
						<Input
							id="email"
							name="email"
							placeholder="Email"
							type="email"
							autoCapitalize="none"
							autoComplete="email"
							autoCorrect="off"
							readOnly={isLoading}
							required
						/>
					</div>
					<div className="grid gap-1">
						<Label className="sr-only" htmlFor="password">
							Password
						</Label>
						<Input
							id="password"
							name="password"
							placeholder="Password"
							type="password"
							autoCapitalize="none"
							autoComplete="password"
							autoCorrect="off"
							readOnly={isLoading}
							required
						/>
					</div>
					{recaptchaSiteKey ? (
						<ReCaptcha ref={recaptchaRef} siteKey={recaptchaSiteKey} onVerify={setRecaptchaToken} />
					) : null}
					<button
						type="submit"
						className={cn(buttonVariants())}
						disabled={isLoading || (recaptchaEnabled && !recaptchaToken)}
					>
						{isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						Sign In
					</button>
				</div>
			</form>
		</div>
	);
};
