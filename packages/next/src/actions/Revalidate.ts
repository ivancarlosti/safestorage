'use server';

import { revalidateTag } from 'next/cache';

export const customRevalidateTag = async (tag: string) => {
	revalidateTag(tag);
};
