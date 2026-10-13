import { bundledLanguages, createHighlighter } from 'shiki';

export const highlighter = await createHighlighter({
	themes: ['github-dark-dimmed'],
	langs: Object.keys(bundledLanguages)
});
