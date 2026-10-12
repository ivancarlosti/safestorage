'use server';

import { revalidateTag } from 'next/cache';

export const saveSettings = async () => {
	revalidateTag('settings');
};
