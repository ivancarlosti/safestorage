'use client';

import { selectedFileAtom, isDialogOpenAtom } from '@/lib/atoms/fileDialog';
import { isFileImage, isFileVideo, isFileAudio, isFilePDF } from '@/lib/file';
import { cn } from '@/lib/utils';
import type { FilePropsType, FileWithIndex } from '@/types';
import { useSetAtom } from 'jotai';
import { FileWarning, Video, FileAudio, FileText, FileIcon } from 'lucide-react';
import { useState, type PropsWithChildren } from 'react';

const truncateName = (name: string) => (name.length > 60 ? `${name.slice(0, 40)}...` : name);

const ComponentType = ({
	children,
	isTableView,
	file,
	type
}: PropsWithChildren<{
	readonly file?: FileWithIndex;
	readonly isTableView?: boolean;
	readonly type: FilePropsType;
}>) => {
	const setModalOpen = useSetAtom(isDialogOpenAtom);
	const setSelectedFile = useSetAtom(selectedFileAtom);

	return isTableView && file ? (
		<button
			type="button"
			className="flex flex-col justify-center items-center relative"
			onClick={e => {
				e.preventDefault();
				e.stopPropagation();

				if (file.quarantine && type !== 'quarantine') {
					return;
				}

				setSelectedFile(file);
				setModalOpen(true);
			}}
		>
			{children}
		</button>
	) : (
		<>{children}</>
	);
};

export const FileThumbnail = ({
	file,
	hoveredFiles = [],
	isTableView = false,
	type
}: {
	readonly file: FileWithIndex;
	readonly hoveredFiles?: string[];
	readonly isTableView?: boolean;
	readonly type: FilePropsType;
}) => {
	const [error, setError] = useState(false);

	// Table rows show a compact preview; the grid keeps the big masonry thumbnails.
	const iconClassName = isTableView ? 'h-6 w-6' : 'h-16 w-16';
	const placeholderClassName = isTableView ? 'h-10 w-10' : 'h-40 bg-dark-90';

	return file.quarantine ? (
		<div className={cn('flex flex-col justify-center items-center', placeholderClassName)}>
			<FileWarning className={cn('text-red-500', iconClassName)} />
		</div>
	) : (isFileImage(file) && !error) || (isFileVideo(file) && file.thumb && !error) ? (
		<ComponentType isTableView={isTableView} file={file} type={type}>
			<picture className={isTableView ? 'block' : undefined}>
				<img
					src={file.thumb}
					className={cn(
						'cursor-pointer',
						isTableView ? 'h-10 w-10 rounded object-cover' : 'w-full sm:min-w-[160px] min-w-0'
					)}
					onError={() => setError(true)}
				/>
			</picture>

			{isFileVideo(file) && hoveredFiles.includes(file.uuid ?? file.name) && (
				<video
					className="preview absolute top-0 left-0 w-full h-full pointer-events-none sm:min-w-[160px] min-w-0"
					autoPlay
					loop
					muted
				>
					<source src={file.preview} type="video/mp4" />
				</video>
			)}

			{isFileVideo(file) ? (
				<Video
					className={cn('absolute bottom-1 right-1 pointer-events-none', isTableView ? 'h-4 w-4' : 'h-6 w-6')}
				/>
			) : null}
		</ComponentType>
	) : (
		<div className={cn('flex flex-col justify-center items-center cursor-pointer', placeholderClassName)}>
			<ComponentType isTableView={isTableView} file={file} type={type}>
				{isFileAudio(file) ? <FileAudio className={iconClassName} /> : null}
				{isFilePDF(file) ? <FileText className={iconClassName} /> : null}
				{isFileAudio(file) || isFilePDF(file) ? null : <FileIcon className={iconClassName} />}
				{isTableView ? null : (
					<span className="break-all w-[160px] mt-4 text-lg text-center">
						{truncateName(file.original ? file.original : file.name)}
					</span>
				)}
			</ComponentType>
		</div>
	);
};
