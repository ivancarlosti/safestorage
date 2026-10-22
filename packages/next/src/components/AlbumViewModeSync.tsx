'use client';

import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import type { ViewMode } from '@/types';
import { albumViewModeAtom } from '@/lib/atoms/settings';

/*
	Publishes the view mode returned by the API to the client components that
	render the file list, and clears it when another page takes over.
*/
export const AlbumViewModeSync = ({ viewMode }: { readonly viewMode: ViewMode }) => {
	const setViewMode = useSetAtom(albumViewModeAtom);

	useEffect(() => {
		setViewMode(viewMode);

		return () => setViewMode(null);
	}, [setViewMode, viewMode]);

	return null;
};
