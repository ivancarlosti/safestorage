'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { toast } from 'sonner';

import { debug } from '@/lib/utils';

/*
	reCAPTCHA v2 checkbox, loaded straight from Google's CDN with
	`render=explicit` so that no package is added for a third-party script that
	has to be fetched over the network anyway.

	The widget is rendered by hand (and not by an implicit script tag) because the
	form has to know whether an answer was already given, and because the answer
	has to be cleared after a failed submit: a token is single use.
*/

const SCRIPT_ID = 'safestorage-recaptcha';
const SCRIPT_URL = 'https://www.google.com/recaptcha/api.js?render=explicit';
const SCRIPT_ERROR = 'The reCAPTCHA script could not be loaded';

interface ReCaptchaParameters {
	callback: (token: string) => void;
	'error-callback': () => void;
	'expired-callback': () => void;
	sitekey: string;
	theme: 'dark' | 'light';
}

interface ReCaptchaWidget {
	ready: (callback: () => void) => void;
	render: (container: HTMLElement, parameters: ReCaptchaParameters) => number;
	reset: (widgetId?: number) => void;
}

declare global {
	interface Window {
		grecaptcha?: ReCaptchaWidget | undefined;
	}
}

let scriptPromise: Promise<void> | null = null;

/*
	One promise per page, so a form that mounts while the script is still being
	downloaded waits for the same script instead of injecting a second copy.

	Both helpers stay synchronous on purpose (hence the disabled rule): awaiting
	before the cache is written would let two concurrent mounts build a promise
	each, and the second one would attach its `load` listeners to a script that
	already fired them, so it would never settle.
*/
// eslint-disable-next-line @typescript-eslint/promise-function-async
const createScriptPromise = () =>
	new Promise<void>((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(`script[id="${CSS.escape(SCRIPT_ID)}"]`);
		const script = existing ?? document.createElement('script');

		if (!existing) {
			script.id = SCRIPT_ID;
			script.src = SCRIPT_URL;
			script.async = true;
			script.defer = true;
			document.head.append(script);
		}

		script.addEventListener('load', () => resolve(), { once: true });
		script.addEventListener('error', () => reject(new Error(SCRIPT_ERROR)), { once: true });
	});

// eslint-disable-next-line @typescript-eslint/promise-function-async
const getScriptPromise = () => (scriptPromise ??= createScriptPromise());

// A failed load drops the promise again, otherwise every later mount would replay
// the same error without ever retrying.
const dropScriptPromise = () => {
	scriptPromise = null;
};

const loadReCaptcha = async () => {
	if (typeof window === 'undefined' || window.grecaptcha) return;

	try {
		await getScriptPromise();
	} catch (error) {
		dropScriptPromise();
		throw error;
	}
};

export interface ReCaptchaHandle {
	reset: () => void;
}

interface ReCaptchaProps {
	readonly onVerify: (token: string) => void;
	readonly siteKey: string;
}

export const ReCaptcha = forwardRef<ReCaptchaHandle, ReCaptchaProps>(({ onVerify, siteKey }, ref) => {
	const container = useRef<HTMLDivElement>(null);
	const widget = useRef<number | null>(null);
	// The callbacks below outlive the render they were created in, so the prop is
	// always read through a ref instead of being captured.
	const onVerifyRef = useRef(onVerify);

	useEffect(() => {
		onVerifyRef.current = onVerify;
	}, [onVerify]);

	useImperativeHandle(ref, () => ({
		reset: () => {
			if (widget.current === null || !window.grecaptcha) return;

			window.grecaptcha.reset(widget.current);
			// The parent has to forget the answer as well, or it would send a
			// token that was already used.
			onVerifyRef.current('');
		}
	}));

	useEffect(() => {
		// React runs this twice in development; the flag keeps the first (aborted)
		// pass from rendering a second widget into the same container, which the
		// API rejects.
		let cancelled = false;

		const render = async () => {
			try {
				await loadReCaptcha();

				const { grecaptcha } = window;
				if (cancelled || !grecaptcha || !container.current || widget.current !== null) return;

				grecaptcha.ready(() => {
					if (cancelled || !grecaptcha || !container.current || widget.current !== null) return;

					widget.current = grecaptcha.render(container.current, {
						callback: token => onVerifyRef.current(token),
						'error-callback': () => onVerifyRef.current(''),
						'expired-callback': () => onVerifyRef.current(''),
						sitekey: siteKey,
						// The widget is an iframe from another origin, so it can not
						// be styled: it is told which palette the page uses instead.
						theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
					});
				});
			} catch (error) {
				debug('The reCAPTCHA widget could not be loaded', error);
				toast.error('The reCAPTCHA challenge could not be loaded, please try again later');
			}
		};

		void render();

		return () => {
			cancelled = true;
		};
	}, [siteKey]);

	return <div ref={container} className="flex justify-center" />;
});

ReCaptcha.displayName = 'ReCaptcha';
