'use client';

import { type ComponentProps, useEffect, useMemo, useState } from 'react';
import { useAtom } from 'jotai';
import { CopyIcon, InfoIcon, Loader2, XIcon } from 'lucide-react';

import { uploadsAtom } from '@/lib/atoms/uploads';
import { formatBytes } from '@/lib/file';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';

import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useCopyToClipboard } from 'usehooks-ts';
import { Label, ProgressBar as ReactAriaProgressBar } from 'react-aria-components';
import { Tooltip } from './Tooltip';

type Status = 'complete' | 'error' | 'idle' | 'uploading';

const clampPercentage = (percentage: number | undefined) => {
	if (typeof percentage !== 'number' || !Number.isFinite(percentage)) return 0;
	return Math.min(100, Math.max(0, percentage));
};

/*
	Purely presentational: the header passes `role="progressbar"` and the
	`aria-value*` attributes, while the per-file rows already sit inside the React
	Aria `ProgressBar`, whose element owns that role (nesting two would make the
	screen reader announce the same upload twice).

	The header also picks its own colours, because that bar sits on the trigger
	button and `bg-primary` is hsl(210 40% 98%). A white fill was invisible there
	(1.05:1) and so was the old `bg-white/40` track (1.02:1), so the upload looked
	stuck at 0% whatever the real value was. `bg-blue-600` on `bg-blue-600/20`
	gives 4.9:1 and 1.3:1 and reads on both the light button and the dark popover.
	The per-file tracks keep the default `bg-white/25`, which sits on that popover.
*/
const ProgressTrack = ({
	className,
	fillClassName,
	percentage,
	trackClassName = 'bg-white/25',
	...props
}: {
	readonly fillClassName: string;
	readonly percentage: number | undefined;
	readonly trackClassName?: string;
} & ComponentProps<'div'>) => (
	<div {...props} className={cn('relative h-2 w-full overflow-hidden rounded-full', trackClassName, className)}>
		<div
			className={cn('h-full rounded-full transition-[width] duration-300 ease-out', fillClassName)}
			style={{ width: `${clampPercentage(percentage)}%` }}
		/>
	</div>
);

export const UploadProgress = () => {
	const [open, setOpen] = useState(false);
	const [uploads, setUploads] = useAtom(uploadsAtom);
	const [buttonText, setButtonText] = useState('');
	const [status, setStatus] = useState<Status>('idle');
	const [_, copy] = useCopyToClipboard();
	const queryClient = useQueryClient();

	/*
		Derived straight from the atom instead of being copied into state by an
		effect: one less render for every progress event, and the bar can never
		show a figure that is older than the one the uploader just reported.
	*/
	const inFlight = useMemo(() => uploads.filter(file => file.processing), [uploads]);

	const { bytesSent, bytesTotal } = useMemo(() => {
		let total = 0;
		let sent = 0;

		for (const file of inFlight) {
			total += file.bytesTotal;

			// `bytesSent` is what the uploader measured, `progress` is the fallback for entries without sizes
			const fileSent = file.bytesSent || (file.bytesTotal * clampPercentage(file.progress)) / 100;
			sent += file.bytesTotal > 0 ? Math.min(fileSent, file.bytesTotal) : fileSent;
		}

		return { bytesSent: sent, bytesTotal: total };
	}, [inFlight]);

	/*
		Only the uploads in flight are counted: including the ones that already
		finished would make a newly started upload begin with a bar that is
		partially (or completely) full. Each upload is weighted by its size so a
		small file finishing first does not report a big one as done.
	*/
	const totalProgress = useMemo(() => {
		if (inFlight.length === 0) return 0;

		if (bytesTotal === 0) {
			// Sizes are unknown (the instance settings are still loading): average the percentages
			let sum = 0;
			for (const file of inFlight) sum += clampPercentage(file.progress);
			return sum / inFlight.length;
		}

		return Math.min(100, (bytesSent / bytesTotal) * 100);
	}, [bytesSent, bytesTotal, inFlight]);

	const removeFile = (uuid: string) => {
		setUploads(uploads.filter(file => file.uuid !== uuid));
		// TODO: Not entirely sure why the array is not empty after removing the last file
		if (uploads.length === 1) setOpen(false);
	};

	const clearAll = () => {
		setUploads([]);
		setOpen(false);
	};

	const copyAllLinks = () => {
		const links = uploads.map(file => file.url).join('\n');
		void copy(links);
	};

	useEffect(() => {
		const uploading = uploads.filter(file => file.processing).length;
		const failed = uploads.filter(file => file.status === 'error').length;
		let timeout: NodeJS.Timeout;

		if (uploading > 0) {
			setStatus('uploading');
			setButtonText(`Uploading ${uploading} file${uploading === 1 ? '' : 's'}`);
		} else if (failed > 0) {
			/*
				A failed upload is not a completed one. Saying so here is what keeps
				the panel from claiming success while files were never uploaded.
			*/
			setStatus('error');
			setButtonText(`${failed} of ${uploads.length} upload${uploads.length === 1 ? '' : 's'} failed`);
		} else if (uploads.length > 0) {
			setStatus('complete');
			setButtonText('All uploads complete 🎉');
			timeout = setTimeout(() => {
				let queryKey = ['uploads'];
				const albumUpload = uploads.find(file => file.albumUuid);
				if (albumUpload) {
					queryKey = ['album', albumUpload.albumUuid!];
				}

				void queryClient.invalidateQueries({ queryKey });
			}, 1000);
		} else {
			setStatus('idle');
			setButtonText('');
		}

		return () => {
			clearTimeout(timeout);
		};
	}, [queryClient, uploads]);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				{buttonText ? (
					<Button
						variant={status === 'error' ? 'destructive' : 'default'}
						/*
							`h-auto` and the flat padding win over the size variant's
							`h-10 py-2` through `cn` (tailwind-merge), so the bar and the
							labels fit in the button instead of overflowing it.
						*/
						className={cn(
							'transition-all',
							status === 'uploading' ? 'h-auto min-h-10 w-auto flex-col px-3 py-1.5' : ''
						)}
					>
						{status === 'uploading' ? (
							<span className="flex w-full flex-col gap-1">
								<span className="flex w-full items-center gap-2 text-xs font-medium tabular-nums">
									<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
									<span className="flex-1 text-left">{buttonText}</span>
									<span>{Math.round(totalProgress)}%</span>
								</span>
								<ProgressTrack
									role="progressbar"
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={Math.round(totalProgress)}
									aria-label="Overall upload progress"
									aria-valuetext={`${Math.round(totalProgress)}%`}
									fillClassName="bg-blue-600"
									trackClassName={cn('bg-blue-600/20', totalProgress === 0 && 'animate-pulse')}
									percentage={totalProgress}
									className="w-56 sm:w-72"
								/>
								<span className="w-full text-left text-[0.7rem] leading-none opacity-70">
									{bytesTotal > 0
										? `${formatBytes(bytesSent)} of ${formatBytes(bytesTotal)}`
										: 'Preparing upload…'}
								</span>
							</span>
						) : null}
						{status === 'uploading' ? null : buttonText}
					</Button>
				) : null}
			</PopoverTrigger>
			<PopoverContent className="w-[512px] mt-2">
				{uploads.length > 0 ? (
					<div className="flex flex-row gap-2 text-sm justify-end mb-4">
						{uploads.length > 1 ? (
							<Button size="sm" variant="outline" onClick={() => copyAllLinks()}>
								Copy all links
							</Button>
						) : null}
						<Button size="sm" variant="outline" onClick={() => clearAll()}>
							Clear all
						</Button>
					</div>
				) : null}
				<ScrollArea className="w-full h-72">
					<ul className="">
						{uploads.map(file => (
							<li key={file.uuid} className="flex items-center justify-between flex-col mb-4 last:mb-0">
								<ReactAriaProgressBar
									value={file.progress}
									className="flex flex-col gap-3 w-full text-white"
									aria-label="File progress bar"
								>
									{({ percentage, valueText }) => (
										<>
											<div className="flex text-sm">
												{file.status === 'uploading' ? (
													<>
														<Label className="flex-1">Uploading {file.name}...</Label>
														<span>{valueText}</span>
													</>
												) : file.status === 'success' ? (
													<div className="flex justify-between flex-1 gap-4 items-center">
														<a
															href={file.url}
															target="_blank"
															rel="noopener noreferrer"
															className="link flex items-center gap-1"
														>
															{file.name}
														</a>
														<div className="flex">
															<Tooltip content="Copy link">
																<Button
																	variant="ghost"
																	size="icon"
																	className="w-6 h-6"
																	onClick={() => void copy(file.url ?? '')}
																>
																	<CopyIcon className="h-4 w-4" />
																</Button>
															</Tooltip>

															<Tooltip content="Remove from list">
																<Button
																	variant="ghost"
																	size="icon"
																	className="w-6 h-6"
																	onClick={() => removeFile(file.uuid)}
																>
																	<XIcon className="h-4 w-4" />
																</Button>
															</Tooltip>
														</div>
													</div>
												) : file.status === 'error' ? (
													<div className="flex justify-between flex-1 gap-4 items-start">
														<div className="flex flex-col">
															<span>{file.name}</span>
															<span className="text-xs text-red-400">
																{file.error ?? 'An unexpected error ocurred'}
															</span>
														</div>
														<div className="flex items-center">
															<Tooltip
																content={file.error ?? 'An unexpected error ocurred'}
															>
																<InfoIcon className="h-4 w-4 text-red-500" />
															</Tooltip>

															<Tooltip content="Remove from list">
																<Button
																	variant="ghost"
																	size="icon"
																	className="w-6 h-6"
																	onClick={() => removeFile(file.uuid)}
																>
																	<XIcon className="h-4 w-4" />
																</Button>
															</Tooltip>
														</div>
													</div>
												) : null}
											</div>
											<ProgressTrack
												fillClassName={file.error ? 'bg-red-500' : 'bg-white'}
												percentage={percentage}
											/>
										</>
									)}
								</ReactAriaProgressBar>
							</li>
						))}
					</ul>
				</ScrollArea>
			</PopoverContent>
		</Popover>
	);
};
