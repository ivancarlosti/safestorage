import { rmdir } from 'node:fs/promises';
import path, { basename, extname } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { Blake3Hasher } from '@napi-rs/blake-hash';
import slugify from '@sindresorhus/slugify';
import Zip from 'adm-zip';
import type { FastifyRequest } from 'fastify';
import jetpack from 'fs-jetpack';
import randomstring from 'randomstring';
import { v4 as uuidv4 } from 'uuid';
import prisma from '@/structures/database.js';
import type { FileInProgress, RequestUser, User } from '@/structures/interfaces.js';
import { SETTINGS } from '@/structures/settings.js';
import {
	getSiteStorageDirectory,
	getSiteStorageKey,
	isSiteStorageKey,
	normalizeSitePath
} from '@/utils/AlbumWebsite.js';
import { log, logError } from '@/utils/Logger.js';
import { generateThumbnails, getFileThumbnail, removeThumbs } from './Thumbnails.js';
import type { UploadAlbum } from './UploadHelpers.js';
import { getHost } from './Util.js';

const fileIdentifierMaxTries = 5;

// const preserveExtensions = [
// 	/\.tar\.\w+/i // tarballs
// ];
export const uploadPath = fileURLToPath(new URL('../../../../uploads', import.meta.url));
export const watchPath = fileURLToPath(new URL('../../../../uploads/live', import.meta.url));
export const tmpUploadPath = fileURLToPath(new URL('../../../../uploads/tmp', import.meta.url));
export const quarantinePath = fileURLToPath(new URL('../../../../uploads/quarantine', import.meta.url));

export const isExtensionBlocked = (extension: string) => {
	if (!extension && SETTINGS.blockNoExtension) return true;
	return SETTINGS.blockedExtensions.includes(extension);
};

export const getMimeFromType = (fileTypeMimeObj: Record<string, null>) => fileTypeMimeObj.mime;

export const getUniqueFileIdentifier = async (): Promise<string | null> => {
	const options = {
		length: SETTINGS.generatedFilenameLength
	};

	if (!SETTINGS.enableMixedCaseFilenames || process.platform === 'win32') {
		// @ts-ignore
		options.capitalization = 'lowercase';
	}

	for (let i = 0; i < fileIdentifierMaxTries; i++) {
		const identifier = randomstring.generate(options);

		// `LIKE` here relies on the table's case-insensitive collation, which
		// Prisma sets to `utf8mb4_unicode_ci` when it creates the tables. That
		// mirrors SQLite's default ASCII case-insensitive `LIKE`, so identifiers
		// are still compared the way they always were.
		const exists = await prisma.$queryRaw<{ id: number }[]>`
		SELECT id from files
		WHERE name LIKE ${`${identifier}.%`}
		LIMIT 1;
	`;

		if (!exists.length) {
			return identifier;
		}
	}

	log.error('Couldnt allocate identifier for file');
	return null;
};

export const deleteTmpFile = async (uploadPath: string) => {
	try {
		await jetpack.removeAsync(uploadPath);
	} catch (error) {
		logError(log, `There was an error removing the file at < ${uploadPath} >`, error);
	}
};

/*
	A website file lives in a folder of its own, so removing it can leave empty
	folders behind. They are pruned up to `uploads/`; an empty directory is not
	worth an error, so the walk simply stops at the first non-empty one.
*/
export const pruneEmptyDirectories = async (directory: string) => {
	let current = directory;
	while (current.startsWith(uploadPath) && current !== uploadPath) {
		try {
			await rmdir(current);
		} catch {
			return;
		}

		current = path.dirname(current);
	}
};

/*
	The file a website upload replaces. A website is edited by uploading the
	changed file again, so the row of that path (and with it the uuid the public
	links point at) is updated instead of a second row being added next to it.
*/
export const findSiteFileToReplace = async ({ albumId, sitePath }: { albumId: number; sitePath: string }) =>
	prisma.files.findFirst({
		where: {
			sitePath,
			albums: {
				some: {
					id: albumId
				}
			}
		},
		include: {
			quarantineFile: true
		}
	});

/*
	Replaces the content of an existing website file in place. The uuid and the
	quarantine state are kept: a quarantined file is never silently reinstated by
	an upload (the callers refuse to replace it).
*/
export const updateSiteFileOnDb = async ({
	file,
	user,
	uuid
}: {
	file: FileInProgress;
	user?: RequestUser | User | undefined;
	uuid: string;
}) => {
	const now = new Date();
	const data = {
		userId: user?.id ?? undefined!,
		name: file.name,
		original: file.original,
		type: file.type,
		size: file.size,
		hash: file.hash,
		ip: file.ip,
		isS3: file.isS3,
		isWatched: file.isWatched,
		sitePath: file.sitePath ?? null,
		editedAt: now
	};

	const updated = await prisma.files.update({
		where: { uuid },
		data
	});

	return { file: { ...data, createdAt: updated.createdAt, id: updated.id, uuid: updated.uuid } };
};

export const deleteFiles = async ({
	files,
	deleteFromDB = false
}: {
	deleteFromDB?: boolean;
	files: {
		isS3: boolean;
		isWatched: boolean;
		name: string;
		quarantine: boolean;
		quarantineFile: { name: string } | null;
		uuid: string;
	}[];
}) => {
	const s3Files = files.filter(file => file.isS3);
	const localFiles = files.filter(file => !file.isS3);

	try {
		if (s3Files.length) {
			const { createS3Client } = await import('@/structures/s3.js');
			const S3Client = createS3Client();

			const command = new DeleteObjectsCommand({
				Bucket: SETTINGS.S3Bucket,
				Delete: {
					Objects: s3Files.map(file => ({
						Key: file.quarantine ? `quarantine/${file.quarantineFile?.name ?? file.name}` : file.name
					})),
					Quiet: true
				}
			});

			await S3Client.send(command);
		}

		if (localFiles.length) {
			for (const file of localFiles) {
				if (file.quarantine) {
					await prisma.files.update({
						where: {
							uuid: file.uuid
						},
						data: {
							quarantine: false,
							quarantineFile: {
								delete: true
							}
						}
					});
				}

				const name = file.quarantine ? (file.quarantineFile?.name ?? file.name) : file.name;
				const root = file.quarantine ? quarantinePath : file.isWatched ? watchPath : uploadPath;
				await jetpack.removeAsync(path.join(root, name));

				if (!file.quarantine && !file.isWatched && isSiteStorageKey(file.name)) {
					await pruneEmptyDirectories(getSiteStorageDirectory(path.join(uploadPath, file.name)));
				}
			}
		}

		for (const file of files) {
			await deleteThumbnails(file.name);
		}

		if (deleteFromDB) {
			await prisma.files.deleteMany({
				where: {
					uuid: {
						in: files.map(file => file.uuid)
					}
				}
			});
		}
	} catch (error) {
		logError(
			log,
			`There was an error removing one/all of the files < [${files.map(file => file.name).join(', ')}] >`,
			error
		);
	}
};

export const deleteThumbnails = async (filename: string) => {
	const thumbName = getFileThumbnail(filename);
	if (thumbName) await removeThumbs(thumbName);
};

export const purgeUserFiles = async (userId: number) => {
	try {
		const files = await prisma.files.findMany({
			where: {
				userId
			},
			include: {
				quarantineFile: true
			}
		});

		await deleteFiles({ files });

		await prisma.files.deleteMany({
			where: {
				userId
			}
		});
	} catch (error) {
		logError(log, 'Failed to purge the files of a user', error);
	}
};

export const purgePublicFiles = async () => {
	try {
		const files = await prisma.files.findMany({
			where: {
				userId: null
			},
			include: {
				quarantineFile: true
			}
		});

		await deleteFiles({ files });

		await prisma.files.deleteMany({
			where: {
				userId: null
			}
		});
	} catch (error) {
		logError(log, 'Failed to purge the public files', error);
	}
};

export const purgeIpFiles = async (ip: string) => {
	try {
		const files = await prisma.files.findMany({
			where: {
				ip
			},
			include: {
				quarantineFile: true
			}
		});

		await deleteFiles({ files });

		await prisma.files.deleteMany({
			where: {
				ip
			}
		});
	} catch (error) {
		logError(log, 'Failed to purge the files of an IP address', error);
	}
};

export const getFilenameFromPath = (fullPath: string) => fullPath.replace(/^.*[/\\]/, '');

export const createZip = (files: string[], albumUuid: string) => {
	try {
		const zip = new Zip();
		for (const file of files) {
			zip.addLocalFile(path.join(uploadPath, file));
		}

		zip.writeZip(fileURLToPath(new URL(`../../../../uploads/zips/${albumUuid}.zip`, import.meta.url)));
	} catch (error) {
		logError(log, `Failed to create the zip for the album ${albumUuid}`, error);
	}
};

export const constructFilePublicLink = ({
	req,
	fileName,
	uuid,
	quarantine = false,
	isS3 = false,
	isWatched = false
}: {
	fileName: string;
	isS3?: boolean;
	isWatched?: boolean;
	quarantine?: boolean;
	req: FastifyRequest;
	uuid?: string;
}) => {
	const host = SETTINGS.serveUploadsFrom ? SETTINGS.serveUploadsFrom : getHost(req);
	/*
		A website file is stored under a nested key (`site/{album}/{sitePath}`)
		that is not reachable as a flat upload URL, and the album it belongs to
		may have no public link at all. It is served by uuid instead, which is
		also what keeps the gallery previews and the album cover working.
	*/
	const isSiteFile = !quarantine && Boolean(uuid) && isSiteStorageKey(fileName);
	const data = {
		url: isSiteFile
			? `${host}/api/file/${uuid}/content`
			: isS3
				? `${SETTINGS.S3PublicUrl || SETTINGS.S3Endpoint}${quarantine ? '/quarantine' : ''}/${fileName}`
				: `${host}${quarantine ? '/quarantine' : ''}${isWatched ? '/live' : ''}/${fileName}`,
		thumb: '',
		preview: ''
	};

	const { thumb, preview } = getFileThumbnail(fileName) ?? {};
	if (thumb) {
		data.thumb = `${host}/thumbs/${thumb}`;
		if (preview) {
			data.preview = `${host}/thumbs/preview/${preview}`;
		}
	}

	return data;
};

/**
 * Replaces the raw `albums` rows of the given files with their public shape,
 * adding the owner (username + uuid) of every album.
 *
 * Album ownership is stored as a plain `albums.userId` column, so all owners
 * referenced by the page are resolved with a single extra query.
 */
export const resolveAlbumOwners = async <T extends { albums: { name: string; userId: number; uuid: string }[] }>(
	files: T[]
) => {
	const ownerIds = [...new Set(files.flatMap(file => file.albums.map(album => album.userId)))];
	const owners = ownerIds.length
		? await prisma.users.findMany({
				where: { id: { in: ownerIds } },
				select: {
					id: true,
					username: true,
					uuid: true
				}
			})
		: [];
	const ownersById = new Map(owners.map(owner => [owner.id, owner] as const));

	return files.map(file => ({
		...file,
		albums: file.albums.map(album => {
			const owner = ownersById.get(album.userId);
			return {
				name: album.name,
				uuid: album.uuid,
				user: owner ? { username: owner.username, uuid: owner.uuid } : null
			};
		})
	}));
};

export const checkFileHashOnDB = async (user: RequestUser | User | undefined, file: FileInProgress) => {
	/*
		Guests are never deduplicated: matching them against every anonymous row
		would hand them a file that belongs to another visitor (and that is not
		part of the album they are uploading to).
	*/
	if (!user) return null;

	const dbFile = await prisma.files.findFirst({
		where: {
			hash: file.hash,
			size: file.size,
			user: {
				id: user.id
			}
		}
	});

	if (dbFile) {
		return {
			// TODO: If public uploads are enabled we probably should NOT return the IP
			// from which the file was uploaded
			file: dbFile,
			repeated: true
		};
	}

	return null;
};

export const checkFileNameOnDB = async (user: RequestUser | User | undefined, fileName: string) => {
	const dbFile = await prisma.files.findFirst({
		where: {
			name: fileName,
			isWatched: true,
			user: user
				? {
						id: user.id
					}
				: {}
		}
	});

	if (dbFile) {
		return {
			file: dbFile,
			repeated: true
		};
	}

	return null;
};

export const storeFileToDb = async (
	user: RequestUser | User | undefined,
	file: FileInProgress,
	albumId?: number | null
) => {
	const now = new Date();

	const data = {
		userId: user?.id ?? undefined!,
		uuid: uuidv4(),
		name: file.name,
		original: file.original,
		type: file.type,
		size: file.size,
		hash: file.hash,
		ip: file.ip,
		sourceUrl: file.sourceUrl ?? null,
		isS3: file.isS3,
		isWatched: file.isWatched,
		// Path inside a static website album, when the upload came with one
		sitePath: file.sitePath ?? null,
		createdAt: now,
		editedAt: now
	};

	if (albumId && albumId !== null && albumId !== undefined) {
		const fileId = await prisma.files.create({
			data: {
				...data,
				albums: {
					connect: {
						id: albumId
					}
				}
			}
		});

		return {
			file: {
				id: fileId.id,
				...data
			}
		};
	} else {
		const fileId = await prisma.files.create({
			data
		});

		return {
			file: {
				id: fileId.id,
				...data
			}
		};
	}
};

export const updateFileOnDb = async (user: RequestUser | User | undefined, file: FileInProgress & { uuid: string }) => {
	const now = new Date();

	const data = {
		userId: user?.id ?? undefined!,
		name: file.name,
		original: file.original,
		type: file.type,
		size: file.size,
		hash: file.hash,
		ip: file.ip,
		isS3: file.isS3,
		isWatched: file.isWatched,
		createdAt: now,
		editedAt: now
	};

	return prisma.files.update({
		where: { uuid: file.uuid, isWatched: true },
		data
	});
};

export const saveFileToAlbum = async (albumId: number, fileId: number) => {
	const now = new Date();
	await prisma.files.update({
		where: {
			id: fileId
		},
		data: {
			albums: {
				connect: {
					id: albumId
				}
			}
		}
	});

	await prisma.albums.update({
		where: {
			id: albumId
		},
		data: {
			editedAt: now
		}
	});
};

// export const getExtension = (filename: string, lower = false): string => {
// 	// Always return blank string if the filename does not seem to have a valid extension
// 	// Files such as .DS_Store (anything that starts with a dot, without any extension after) will still be accepted
// 	if (!/\../.test(filename)) return '';

// 	let multi = '';
// 	let extension = '';

// 	// check for multi-archive extensions (.001, .002, and so on)
// 	if (/\.\d{3}$/.test(filename)) {
// 		multi = filename.slice(filename.lastIndexOf('.') - filename.length);
// 		// eslint-disable-next-line no-param-reassign
// 		filename = filename.slice(0, filename.lastIndexOf('.'));
// 	}

// 	// check against extensions that must be preserved
// 	for (const extPreserve of preserveExtensions) {
// 		const match = filename.match(extPreserve);
// 		if (match?.[0]) {
// 			extension = match[0];
// 			break;
// 		}
// 	}

// 	if (!extension) {
// 		extension = filename.slice(filename.lastIndexOf('.') - filename.length); // path.extname(filename)
// 	}

// 	const str = extension + multi;
// 	return lower ? str.toLowerCase() : str;
// };

export const hashFile = async (uploadPath: string): Promise<string> => {
	const hasher = new Blake3Hasher();
	const stream = jetpack.createReadStream(uploadPath);
	return new Promise((resolve, reject) => {
		stream.on('data', data => {
			hasher.update(data);
		});

		stream.on('end', () => {
			resolve(hasher.digest('hex'));
			hasher.reset();
		});

		stream.on('error', error => {
			reject(error);
			hasher.reset();
		});
	});
};

export const handleUploadFile = async ({
	user,
	ip,
	upload,
	album,
	sitePath
}: {
	album?: UploadAlbum | null | undefined;
	ip: string;
	sitePath?: string | null;
	upload: { name: string; path: string; size: string; sourceUrl?: string; type: string };
	user?: RequestUser | User | undefined;
}) => {
	const ext = extname(upload.name);
	const normalizedSitePath = sitePath ? normalizeSitePath(sitePath) : null;
	/*
		A file uploaded into a website album is stored exactly where the website
		serves it: `uploads/site/{albumIdentifier}/{sitePath}`, under the name the
		HTML refers to. No random identifier, no suffix, no slugification: renaming
		the file would break `css/app.css`, `CNAME` and friends.
	*/
	const siteKey =
		normalizedSitePath && album?.isWebsite && album.identifier
			? getSiteStorageKey(album.identifier, normalizedSitePath)
			: null;

	const file: FileInProgress = {
		name: '',
		extension: ext,
		path: '',
		original: upload.name,
		type: upload.type,
		size: upload.size,
		hash: await hashFile(upload.path),
		ip,
		sourceUrl: upload.sourceUrl,
		isS3: false,
		isWatched: false,
		/*
			The path is recorded for every album: a gallery album keeps its flat
			name and turns the file into a website file if the album is later
			served as a website.
		*/
		sitePath: normalizedSitePath
	};

	if (siteKey) {
		file.name = siteKey;
		file.path = path.join(uploadPath, siteKey);
	} else {
		// Gallery upload: a unique identifier is generated for the stored name
		const uniqueIdentifier = await getUniqueFileIdentifier();
		if (!uniqueIdentifier) throw new Error('Could not generate unique identifier.');
		let newFilename = `${uniqueIdentifier}${ext}`;
		if (SETTINGS.generateOriginalFileNameWithIdentifier) {
			const isLowerCase = !SETTINGS.enableMixedCaseFilenames || process.platform === 'win32';
			const originalNameWithoutExt = basename(upload.name, ext);
			newFilename = `${slugify(originalNameWithoutExt, { separator: '_', lowercase: isLowerCase })}-${uniqueIdentifier}${ext}`;
		}

		file.name = newFilename;
		file.path = fileURLToPath(new URL(`../../../../uploads/${newFilename}`, import.meta.url));
	}

	log.debug(`> Name for upload: ${file.name}`);

	// A website is edited by uploading the file again: the row is replaced in place
	const existingSiteFile =
		siteKey && normalizedSitePath && album
			? await findSiteFileToReplace({ albumId: album.id, sitePath: normalizedSitePath })
			: null;
	if (existingSiteFile?.quarantine) {
		await deleteTmpFile(upload.path);
		throw new Error('This file is quarantined and cannot be replaced by an upload.');
	}

	if (existingSiteFile) {
		if (existingSiteFile.name !== file.name) {
			// The previous bytes lived under another key (a file uploaded before
			// the folder layout existed); they are replaced, not kept around
			await deleteFiles({ files: [existingSiteFile] });
		}

		await jetpack.dirAsync(path.dirname(file.path));
		// Overwrite: this is exactly how an edited file replaces the old one
		await jetpack.moveAsync(upload.path, file.path, { overwrite: true });

		const savedFile = await updateSiteFileOnDb({ file, user, uuid: existingSiteFile.uuid });
		return savedFile.file;
	}

	let uploadedFile;
	const fileOnDb = siteKey ? null : await checkFileHashOnDB(user, file);
	if (fileOnDb?.repeated) {
		/*
			A duplicate upload can still teach an existing file its place inside a
			website: the file is already stored, only the site path was missing.
		*/
		if (file.sitePath && !fileOnDb.file.sitePath) {
			await prisma.files.update({
				where: { uuid: fileOnDb.file.uuid },
				data: { sitePath: file.sitePath }
			});
		}
		if (SETTINGS.saveDuplicatesToAlbum && album) {
			await saveFileToAlbum(album.id, fileOnDb.file.id);
		} else {
			log.info(
				`> Tried uploading ${file.original} but already exists on database with identifier: ${fileOnDb.file.name}. Consider enabling "Add duplicates to Album"`
			);
		}

		uploadedFile = fileOnDb.file;
		await deleteTmpFile(upload.path);
	} else {
		if (siteKey) {
			await jetpack.dirAsync(path.dirname(file.path));
			// A file left on disk without a row (an interrupted upload) is replaced
			await jetpack.moveAsync(upload.path, file.path, { overwrite: true });
		} else {
			await jetpack.moveAsync(upload.path, file.path);
		}

		// Store file in database
		const savedFile = await storeFileToDb(user ? user : undefined, file, album ? album.id : undefined);

		uploadedFile = savedFile.file;

		// Generate thumbnails
		if (!siteKey) {
			void generateThumbnails({
				filename: savedFile.file.name,
				tmp: savedFile.file.isS3,
				watched: savedFile.file.isWatched
			});
		}
	}

	return uploadedFile;
};
