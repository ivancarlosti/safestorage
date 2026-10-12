/**
 * Dependency-free demo image generator.
 *
 * It writes plain RGB PNGs (no ImageMagick / sharp / canvas needed) that are
 * used as the "uploads" in the screenshots. They are intentionally synthetic:
 * abstract gradients, so no real/private content ever ends up in the README.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c;
	}

	return table;
})();

const crc32 = (buf) => {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const typeBuffer = Buffer.from(type, 'ascii');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
	return Buffer.concat([length, typeBuffer, data, crc]);
};

/** Encode a raw `width * height * 3` RGB buffer as a PNG. */
const encodePng = (width, height, rgb) => {
	const stride = width * 3;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		// One filter byte (0 = None) in front of every scanline.
		raw[y * (stride + 1)] = 0;
		rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // colour type: truecolour RGB
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

	return Buffer.concat([
		signature,
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
};

const hslToRgb = (h, s, l) => {
	const a = s * Math.min(l, 1 - l);
	const f = (n) => {
		const k = (n + h * 12) % 12;
		return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
	};

	return [f(0), f(8), f(4)];
};

/**
 * Renders a diagonal gradient with a soft "bokeh" cluster and a vignette, so the
 * thumbnails in the dashboard look like a plausible photo library.
 *
 * @param {number} width Image width in pixels.
 * @param {number} height Image height in pixels.
 * @param {number} hue Base hue (0-1).
 * @param {number} seed Deterministic per-image variation.
 */
const renderGradient = (width, height, hue, seed) => {
	const rgb = Buffer.alloc(width * height * 3);
	const hueOffset = (seed % 5) * 0.03;
	const blobs = Array.from({ length: 5 }, (_, index) => ({
		x: ((Math.sin(seed * 12.9898 + index * 4.1414) + 1) / 2) * width,
		y: ((Math.cos(seed * 78.233 + index * 2.7182) + 1) / 2) * height,
		r: width * (0.18 + ((seed + index) % 4) * 0.05),
		strength: 0.18 + ((index * 7 + seed) % 5) * 0.04
	}));

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const diagonal = (x / width + y / height) / 2;
			let lightness = 0.14 + diagonal * 0.42;
			let saturation = 0.55 + Math.sin(seed + x * 0.01) * 0.05;

			for (const blob of blobs) {
				const dx = x - blob.x;
				const dy = y - blob.y;
				const distance = Math.sqrt(dx * dx + dy * dy) / blob.r;
				if (distance < 1) lightness += (1 - distance) * (1 - distance) * blob.strength;
			}

			// Vignette: darken the frame edges.
			const cx = (x / width - 0.5) * 2;
			const cy = (y / height - 0.5) * 2;
			lightness *= 1 - Math.min(1, (cx * cx + cy * cy) * 0.22);

			const [r, g, b] = hslToRgb((hue + hueOffset + diagonal * 0.08 + 1) % 1, Math.min(1, saturation), Math.min(1, lightness));
			const offset = (y * width + x) * 3;
			rgb[offset] = Math.round(r * 255);
			rgb[offset + 1] = Math.round(g * 255);
			rgb[offset + 2] = Math.round(b * 255);
		}
	}

	return encodePng(width, height, rgb);
};

/**
 * Generates `count` demo PNGs in `directory` and returns their absolute paths.
 *
 * @param {string} directory Target directory (created if missing).
 * @param {number} [count] How many images to generate.
 * @returns {string[]} The absolute paths of the generated files.
 */
export const generateDemoImages = (directory, count = 9) => {
	mkdirSync(directory, { recursive: true });

	return Array.from({ length: count }, (_, index) => {
		const number = String(index + 1).padStart(2, '0');
		const file = path.join(directory, `demo-${number}.png`);
		const hue = ((index * 0.13) % 1 + 1) % 1;
		writeFileSync(file, renderGradient(1280, 854, hue, index + 3));
		return file;
	});
};

export default generateDemoImages;
