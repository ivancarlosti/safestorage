import type { Settings, ViewMode } from '@/types';
import { atom } from 'jotai';

export const settingsAtom = atom<Settings | null>(null);
export const isMasonryViewAtom = atom(true);
// Set from the album being rendered so the view toggle applies per album instead of globally.
export const albumViewModeAtom = atom<ViewMode | null>(null);
