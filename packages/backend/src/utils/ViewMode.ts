export const VIEW_MODES = ['list', 'thumbs'] as const;

export type ViewMode = (typeof VIEW_MODES)[number];

export const isValidViewMode = (viewMode: string | null | undefined): viewMode is ViewMode => {
	if (!viewMode) return false;

	return VIEW_MODES.includes(viewMode as ViewMode);
};

// Links inherit the album's view mode unless they define their own.
export const resolveViewMode = (...candidates: (string | null | undefined)[]): ViewMode => {
	const viewMode = candidates.find(candidate => isValidViewMode(candidate));
	return viewMode ? (viewMode as ViewMode) : 'thumbs';
};
