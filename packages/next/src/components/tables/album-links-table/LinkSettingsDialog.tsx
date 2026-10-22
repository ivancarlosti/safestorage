'use client';

import { useEffect, useActionState, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { AlbumLink, ViewMode } from '@/types';
import { MessageType } from '@/types';
import { updateLinkSettings } from '@/actions/AlbumSettingsDialogActions';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

export const LinkSettingsDialog = ({ link }: { readonly link: AlbumLink }) => {
	const [open, setOpen] = useState(false);
	const [viewMode, setViewMode] = useState<'default' | ViewMode>(link.viewMode ?? 'default');
	const [allowUploads, setAllowUploads] = useState(link.allowUploads);
	const [hideFiles, setHideFiles] = useState(link.hideFiles);
	const queryClient = useQueryClient();

	const [state, formAction] = useActionState(updateLinkSettings, {
		message: '',
		type: MessageType.Uninitialized
	});

	useEffect(() => {
		if (state.type === MessageType.Error) toast.error(state.message);
		else if (state.type === MessageType.Success) {
			toast.success(state.message);
			setOpen(false);
			void queryClient.invalidateQueries({ queryKey: ['albums', link.albumUuid, 'links'] });
		}

		return () => {
			if (state.type === MessageType.Success) {
				state.type = MessageType.Uninitialized;
				state.message = '';
			}
		};
	}, [link.albumUuid, queryClient, state, state.message, state.type]);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="icon" title="Link settings">
					<SettingsIcon className="h-4 w-4" />
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Link settings</DialogTitle>
					<DialogDescription>Settings specific to /a/{link.identifier}</DialogDescription>
				</DialogHeader>
				<form action={formAction} className="flex flex-col gap-4" id={`link-settings-${link.uuid}`}>
					<input type="hidden" name="uuid" value={link.uuid} />
					<input type="hidden" name="albumUuid" value={link.albumUuid} />
					<input type="hidden" name="viewMode" value={viewMode} />
					<input type="hidden" name="allowUploads" value={allowUploads.toString()} />
					<input type="hidden" name="hideFiles" value={hideFiles.toString()} />

					<div>
						<Label htmlFor={`viewMode-${link.uuid}`}>Display</Label>
						<Select value={viewMode} onValueChange={value => setViewMode(value as 'default' | ViewMode)}>
							<SelectTrigger id={`viewMode-${link.uuid}`}>
								<SelectValue placeholder="Use album default" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="default">Use album default</SelectItem>
								<SelectItem value="thumbs">Thumbnails</SelectItem>
								<SelectItem value="list">List</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs">
						<div className="space-y-0.5">
							<Label htmlFor={`allowUploads-${link.uuid}`}>Allow uploads</Label>
							<p className="text-[0.8rem] text-muted-foreground">
								Visitors can upload files to this album without an account.
							</p>
						</div>
						<Switch
							id={`allowUploads-${link.uuid}`}
							checked={allowUploads}
							onCheckedChange={setAllowUploads}
						/>
					</div>

					<div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs">
						<div className="space-y-0.5">
							<Label htmlFor={`hideFiles-${link.uuid}`}>Hide album contents</Label>
							<p className="text-[0.8rem] text-muted-foreground">
								Drop-only: visitors only see the files they uploaded themselves.
							</p>
						</div>
						<Switch id={`hideFiles-${link.uuid}`} checked={hideFiles} onCheckedChange={setHideFiles} />
					</div>
				</form>
				<DialogFooter>
					<Button type="submit" form={`link-settings-${link.uuid}`}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
