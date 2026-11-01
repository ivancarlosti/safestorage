'use client';

import { useEffect, useState, type PropsWithChildren } from 'react';
import { MessageType, type FilePropsType, type FileWithAdditionalData } from '@/types';
import { useCopyToClipboard, useMediaQuery } from 'usehooks-ts';
import { allowFile, deleteFile, deleteFileAsAdmin, quarantineFile } from '@/actions/FileDialogActions';

import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

import { RegenerateThumbnailFileInformationAction } from './dialogs/file-information/RegenerateThumbnailFileInformationAction';
import { CreateShortUrlDialog } from './dialogs/CreateShortUrlDialog';
import { CreateShortUrlDrawer } from './drawers/CreateShortUrlDrawer';
import { buttonVariants } from '@/styles/button';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import { useAtomValue, useSetAtom } from 'jotai';
import { confirmationDialogAtom } from '@/lib/atoms/dialogs/confirmationDialog';
import { settingsAtom } from '@/lib/atoms/settings';
import { cn } from '@/lib/utils';
import { useServerAction } from '@/hooks/useServerAction';
import { isDialogOpenAtom } from '@/lib/atoms/fileDialog';
import { useQueryClient } from '@tanstack/react-query';

const AllowFileButton = ({
	uuid,
	className,
	isMobile = false
}: {
	readonly className?: string;
	readonly isMobile?: boolean;
	readonly uuid: string;
}) => {
	const setConfirmationDialog = useSetAtom(confirmationDialogAtom);
	const setIsDialogOpen = useSetAtom(isDialogOpenAtom);
	const { formAction, isPending, state } = useServerAction({
		action: allowFile,
		identifier: uuid
	});
	const queryClient = useQueryClient();

	useEffect(() => {
		if (state.type === MessageType.Success) {
			void queryClient.invalidateQueries({ queryKey: ['uploads'] });
			setIsDialogOpen(false);
		}
	}, [state.type, setIsDialogOpen, queryClient]);

	return (
		<button
			type="button"
			disabled={isPending}
			className={cn(isMobile ? buttonVariants({ variant: 'destructive' }) : null, 'w-full', className)}
			onClick={() =>
				setConfirmationDialog({
					callback: () => formAction(),
					description:
						'This action will remove the file from quarantine and allow anyone with a link to access it.'
				})
			}
		>
			Allow file
		</button>
	);
};

const QuarantineFileButton = ({
	uuid,
	className,
	isMobile = false
}: {
	readonly className?: string;
	readonly isMobile?: boolean;
	readonly uuid: string;
}) => {
	const setConfirmationDialog = useSetAtom(confirmationDialogAtom);
	const setIsDialogOpen = useSetAtom(isDialogOpenAtom);
	const { formAction, isPending, state } = useServerAction({
		action: quarantineFile,
		identifier: uuid
	});
	const queryClient = useQueryClient();

	useEffect(() => {
		if (state.type === MessageType.Success) {
			void queryClient.invalidateQueries({ queryKey: ['uploads'] });
			setIsDialogOpen(false);
		}
	}, [state.type, setIsDialogOpen, queryClient]);

	return (
		<button
			type="button"
			disabled={isPending}
			className={cn(isMobile ? buttonVariants({ variant: 'destructive' }) : null, 'w-full', className)}
			onClick={() => {
				setConfirmationDialog({
					callback: () => formAction(),
					description: 'This action will quarantine the file and prevent anyone else from accessing it.'
				});
			}}
		>
			Quarantine file
		</button>
	);
};

const DeleteFileButton = ({
	uuid,
	className,
	isMobile = false,
	type
}: {
	readonly className?: string;
	readonly isMobile?: boolean;
	readonly type?: FilePropsType;
	readonly uuid: string;
}) => {
	const setConfirmationDialog = useSetAtom(confirmationDialogAtom);
	const setIsDialogOpen = useSetAtom(isDialogOpenAtom);
	const { formAction, isPending, state } = useServerAction({
		action: type === 'admin' ? deleteFileAsAdmin : deleteFile,
		identifier: uuid
	});
	const queryClient = useQueryClient();

	useEffect(() => {
		if (state.type === MessageType.Success) {
			void queryClient.invalidateQueries({ queryKey: ['uploads'] });
			setIsDialogOpen(false);
		}
	}, [state.type, setIsDialogOpen, queryClient]);

	return (
		<button
			type="button"
			disabled={isPending}
			className={cn(isMobile ? buttonVariants({ variant: 'destructive' }) : null, 'w-full', className)}
			onClick={() =>
				setConfirmationDialog({
					callback: () => formAction(),
					description: 'Are you sure you want to delete this file?'
				})
			}
		>
			Delete
		</button>
	);
};

export function FileInformationDialogActions({
	file,
	type
}: PropsWithChildren<{ readonly file: FileWithAdditionalData; readonly type: FilePropsType }>) {
	const [_, copy] = useCopyToClipboard();
	const isMobile = useMediaQuery('(max-width: 768px)');
	const settings = useAtomValue(settingsAtom);
	/*
		Public album pages are unauthenticated and a quarantined file is only
		reachable once it has been allowed, so a short URL cannot point at either.
	*/
	const canShorten = Boolean(settings?.useUrlShortener) && type !== 'publicAlbum' && type !== 'quarantine';
	// The Actions drawer is controlled so that it can close before the short-URL
	// drawer opens: two stacked vaul drawers overlap their overlays.
	const [isActionsOpen, setIsActionsOpen] = useState(false);
	const [isShortenOpen, setIsShortenOpen] = useState(false);

	const openShorten = () => {
		setIsActionsOpen(false);
		setIsShortenOpen(true);
	};

	return isMobile ? (
		<>
			<Drawer open={isActionsOpen} onOpenChange={setIsActionsOpen}>
				<DrawerTrigger asChild>
					<Button variant="secondary">Actions</Button>
				</DrawerTrigger>
				<DrawerContent>
					{/* <DrawerClose asChild> */}
					<div className="p-4 pb-0 grid gap-2 mb-2">
						<Button variant="outline" className="w-full" onClick={() => void copy(file.url)}>
							Copy link
						</Button>

						{canShorten ? (
							<Button variant="outline" className="w-full" onClick={openShorten}>
								Create short URL
							</Button>
						) : null}

						<a
							href={file.url}
							target="_blank"
							rel="noopener noreferrer"
							className={buttonVariants({ variant: 'outline', className: 'w-full' })}
						>
							Open in new tab
						</a>

						<a
							href={`/api/file/${file.uuid}/download`}
							rel="noopener noreferrer"
							className={buttonVariants({ variant: 'outline', className: 'w-full' })}
						>
							Download
						</a>

						<RegenerateThumbnailFileInformationAction uuid={file.uuid} isDrawer />
						{type === 'admin' || type === 'quarantine' ? (
							<>
								{file.quarantine ? (
									<AllowFileButton uuid={file.uuid} isMobile={true} />
								) : (
									<QuarantineFileButton uuid={file.uuid} isMobile={true} />
								)}
							</>
						) : null}
						{type === 'publicAlbum' ? null : (
							<DeleteFileButton uuid={file.uuid} isMobile={true} type={type} />
						)}
					</div>
					{/* </DrawerClose> */}
				</DrawerContent>
			</Drawer>
			{canShorten ? (
				<CreateShortUrlDrawer defaultUrl={file.url} onOpenChange={setIsShortenOpen} open={isShortenOpen} />
			) : null}
		</>
	) : (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="secondary">Actions</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-56">
					<DropdownMenuGroup>
						<DropdownMenuItem onClick={() => void copy(file.url)}>Copy link</DropdownMenuItem>
						{canShorten ? (
							<DropdownMenuItem onClick={() => setIsShortenOpen(true)}>Create short URL</DropdownMenuItem>
						) : null}
						<DropdownMenuItem asChild>
							<a href={file.url} target="_blank" rel="noopener noreferrer">
								Open in new tab
							</a>
						</DropdownMenuItem>
						<DropdownMenuItem asChild>
							<a href={`/api/file/${file.uuid}/download`} rel="noopener noreferrer">
								Download
							</a>
						</DropdownMenuItem>
						{type === 'publicAlbum' ? null : (
							<DropdownMenuItem className="p-0">
								<RegenerateThumbnailFileInformationAction uuid={file.uuid} />
							</DropdownMenuItem>
						)}
					</DropdownMenuGroup>
					{type === 'admin' || type === 'quarantine' ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuGroup>
								{file.quarantine ? (
									<DropdownMenuItem
										className="focus:text-destructive-foreground focus:bg-destructive p-0"
										onSelect={e => e.preventDefault()}
									>
										<AllowFileButton
											uuid={file.uuid}
											className="h-full flex px-2 py-1.5 cursor-default"
										/>
									</DropdownMenuItem>
								) : (
									<DropdownMenuItem
										className="focus:text-destructive-foreground focus:bg-destructive p-0"
										onSelect={e => e.preventDefault()}
									>
										<QuarantineFileButton
											uuid={file.uuid}
											className="h-full flex px-2 py-1.5 cursor-default"
										/>
									</DropdownMenuItem>
								)}
							</DropdownMenuGroup>
						</>
					) : null}
					{type === 'publicAlbum' ? null : (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="focus:text-destructive-foreground focus:bg-destructive p-0"
								onSelect={e => e.preventDefault()}
							>
								<DeleteFileButton
									uuid={file.uuid}
									className="h-full flex px-2 py-1.5 cursor-default"
									type={type}
								/>
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{canShorten ? (
				<CreateShortUrlDialog defaultUrl={file.url} onOpenChange={setIsShortenOpen} open={isShortenOpen} />
			) : null}
		</>
	);
}
