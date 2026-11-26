'use client';

import { useEffect, useState, useActionState } from 'react';
import { createAlbum } from '@/actions/CreateAlbum';
import { MessageType } from '@/types';
import { useAtomValue } from 'jotai';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { settingsAtom } from '@/lib/atoms/settings';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function CreateAlbumDialog({ className }: { readonly className?: string }) {
	const [open, setOpen] = useState(false);
	const settings = useAtomValue(settingsAtom);
	const [state, formAction] = useActionState(createAlbum, {
		message: '',
		type: MessageType.Uninitialized
	});

	useEffect(() => {
		if (state.type === MessageType.Error) toast.error(state.message);
		else if (state.type === MessageType.Success) {
			toast.success(state.message);
			setOpen(false);
		}

		return () => {
			if (state.type === MessageType.Success) {
				state.type = MessageType.Uninitialized;
				state.message = '';
			}
		};
	}, [state, state.message, state.type]);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button className={className}>
					<Plus className="mr-2 h-4 w-4" />
					New album
				</Button>
			</DialogTrigger>
			<DialogContent className="w-11/12">
				<form action={formAction}>
					<DialogHeader>
						<DialogTitle>New album</DialogTitle>
						<DialogDescription>Create a new album</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid grid-cols-4 items-center gap-4">
							<Label htmlFor="album" className="text-right">
								Name
							</Label>
							<Input id="album" name="album" placeholder="New album name" className="col-span-3" />
						</div>
						{settings?.websiteHostingEnabled ? (
							<div className="grid grid-cols-4 items-center gap-4">
								<Label htmlFor="isWebsite" className="text-right">
									Website
								</Label>
								<div className="col-span-3 flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs">
									<div className="space-y-0.5">
										<p className="text-sm font-medium leading-none">Static website</p>
										<p className="text-[0.8rem] text-muted-foreground">
											Upload a built site and serve it through a public link. The album gets its
											own folder and every file keeps its name and path, so{' '}
											<code className="font-mono">css/app.css</code> and{' '}
											<code className="font-mono">CNAME</code> work as they are.
										</p>
									</div>
									<Switch id="isWebsite" name="isWebsite" />
								</div>
							</div>
						) : null}
					</div>
					<DialogFooter>
						<Button type="submit">Create</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
