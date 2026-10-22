import { SETTINGS } from '@/structures/settings.js';

type LimiterResult = { allowed: true } | { allowed: false; retryAfter: number };

/*
	Sliding-window limiter for anonymous uploads, kept in memory.

	`Map` mutations are synchronous and Node runs a single thread, so checking and
	recording an upload in one call is atomic. The counters are per process: they
	reset on restart and are not shared between replicas.
*/
const attempts = new Map<string, number[]>();
const cleanupThreshold = 10_000;

export const getAnonymousUploadMaxSize = () =>
	SETTINGS.anonymousUploadsMaxSize > 0
		? Math.min(SETTINGS.maxSize, SETTINGS.anonymousUploadsMaxSize)
		: SETTINGS.maxSize;

const cleanup = (since: number) => {
	for (const [ip, timestamps] of attempts) {
		const recent = timestamps.filter(timestamp => timestamp > since);
		if (recent.length) attempts.set(ip, recent);
		else attempts.delete(ip);
	}
};

export const consumeAnonymousUploadSlot = (ip: string): LimiterResult => {
	const limit = SETTINGS.anonymousUploadsPerIpLimit;
	// 0 (or a negative value saved by hand) means unlimited uploads.
	if (limit <= 0) return { allowed: true };

	const windowMs = Math.max(1, SETTINGS.anonymousUploadsWindowMinutes) * 60_000;
	const now = Date.now();
	const since = now - windowMs;

	const history = (attempts.get(ip) ?? []).filter(timestamp => timestamp > since);

	if (history.length >= limit) {
		attempts.set(ip, history);
		const oldest = history[0]!;
		const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
		return { allowed: false, retryAfter };
	}

	history.push(now);
	attempts.set(ip, history);

	if (attempts.size > cleanupThreshold) cleanup(since);

	return { allowed: true };
};

// Only used by tests, so that a previous test does not use up the next one's window.
export const resetAnonymousUploadLimiter = () => {
	attempts.clear();
};
