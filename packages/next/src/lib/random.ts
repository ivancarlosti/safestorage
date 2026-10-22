/*
	Upload entries that fail before the uploader hands out a uuid still need an
	identifier for the React key and for the lookups in `uploadsAtom`. The value
	is only ever local, but it is a uuid, so it must come from a CSPRNG:
	`Math.random()` is predictable and flagged by CodeQL (js/insecure-randomness).
	`crypto.randomUUID()` only exists in secure contexts (HTTPS or localhost) and
	this project explicitly supports plain-HTTP installs behind an optional
	reverse proxy, so `crypto.getRandomValues()` — available in both — backs the
	fallback. Both branches return an RFC 4122 version 4 uuid.
*/
export const randomUuid = (): string => {
	if (typeof globalThis.crypto.randomUUID === 'function') {
		return globalThis.crypto.randomUUID();
	}

	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
	bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx

	const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
