import prisma from '@/structures/database.js';
import { SETTINGS } from '@/structures/settings.js';

export const getUsedQuota = async (userId: number, extraBytes = 0) => {
	if (!userId) return null;
	try {
		const user = await prisma.users.findFirst({
			where: {
				id: userId
			},
			select: {
				storageQuota: true
			}
		});

		if (!user) return null;

		const userStorageQuota = Number(user.storageQuota);

		// `size` is stored as a string (Prisma has no native 64-bit integer column
		// here), so it has to be cast explicitly: MariaDB/MySQL would otherwise sum
		// it as a DOUBLE, rounding every row and accumulating the error. The cast
		// sums as an exact 64-bit integer, which the `mariadb` driver returns as a
		// string; only the final `Number()` can round, and only beyond 2^53 bytes.
		const result = await prisma.$queryRaw<{ total: number | bigint | string }[]>`
			SELECT SUM(CAST(size AS UNSIGNED)) AS total FROM files WHERE userId = ${userId}
		`;

		// `SUM()` returns `NULL` when the user has no files yet.
		const totalSize = Number(result[0]?.total ?? 0) + extraBytes;

		const data = {
			used: totalSize,
			quota: userStorageQuota === 0 ? SETTINGS.usersStorageQuota : userStorageQuota === -1 ? 0 : userStorageQuota,
			overQuota: false
		};

		// If no global quota and no user quota, return false
		if (SETTINGS.usersStorageQuota === 0 && userStorageQuota === 0) {
			return data;
		}

		// If user quota is set, check if user is over quota
		if (userStorageQuota !== 0) {
			data.overQuota = totalSize > userStorageQuota;
			return data;
		}

		// If user quota is not set, check if user is over global quota
		data.overQuota = totalSize > SETTINGS.usersStorageQuota;
		return data;
	} catch (error: any) {
		throw new Error(error);
	}
};
