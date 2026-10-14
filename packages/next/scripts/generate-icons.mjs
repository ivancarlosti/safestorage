// Regenerates every raster icon (favicons, Apple/PWA/Windows PNGs and the
// multi-size `.ico`) from the single vector master `public/logo.svg`.
//
// Run with: yarn workspace @safestorage/next icons
//
// `sharp` (already a Next.js dependency) rasterises the SVG. The `.ico`
// container is assembled by hand because sharp cannot write Windows icon
// files; the entries embed PNG data, which every browser and Windows Vista+
// understands.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const master = await readFile(join(publicDir, 'logo.svg'));

const renderPng = async (size, output) => {
	const png = await sharp(master, { density: 384 })
		.resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png({ compressionLevel: 9 })
		.toBuffer();

	if (output) {
		await writeFile(join(publicDir, output), png);
	}

	return png;
};

// The sizes in use today, kept identical so no reference has to change
// (`mstile-150x150.png` is deliberately still rendered at 270px).
const pngTargets = [
	['favicon-16x16.png', 16],
	['favicon-32x32.png', 32],
	['apple-touch-icon.png', 180],
	['android-chrome-192x192.png', 192],
	['android-chrome-512x512.png', 512],
	['mstile-150x150.png', 270]
];

for (const [name, size] of pngTargets) {
	await renderPng(size, name);
}

// ICO = 6-byte header + one 16-byte directory entry per image + the PNG data.
const buildIco = images => {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // resource type: icon
	header.writeUInt16LE(images.length, 4); // number of images

	let offset = header.length + images.length * 16;

	const entries = images.map(({ size, png }) => {
		const entry = Buffer.alloc(16);
		entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
		entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
		entry.writeUInt8(0, 2); // palette size
		entry.writeUInt8(0, 3); // reserved
		entry.writeUInt16LE(1, 4); // colour planes
		entry.writeUInt16LE(32, 6); // bits per pixel
		entry.writeUInt32LE(png.length, 8); // bytes in resource
		entry.writeUInt32LE(offset, 12); // offset of resource
		offset += png.length;
		return entry;
	});

	return Buffer.concat([header, ...entries, ...images.map(image => image.png)]);
};

const icoImages = await Promise.all([16, 32, 48].map(async size => ({ size, png: await renderPng(size) })));
await writeFile(join(publicDir, 'favicon.ico'), buildIco(icoImages));

console.log('Icons regenerated from public/logo.svg');
