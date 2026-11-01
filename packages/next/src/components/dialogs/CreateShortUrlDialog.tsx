'use client';

import { useEffect, useState, useActionState } from 'react';
import { MessageType } from '@/types';
import { Copy, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useCopyToClipboard } from 'usehooks-ts';

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
import { createShortURL } from '@/actions/LinksActions';
import { Callout } from '../mdx/Callout';

export function CreateShortUrlDialog({
	className,
	defaultUrl,
	onOpenChange,
	open: controlledOpen
}: {
	readonly className?: string | undefined;
	readonly defaultUrl?: string | undefined;
	readonly onOpenChange?: ((open: boolean) => void) | undefined;
	readonly open?: boolean | undefined;
}) {
	// Callers that open this dialog from a menu own the open state: Radix
	// unmounts the menu content on select, which would take the dialog with it.
	const isControlled = controlledOpen !== undefined;
	const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
	const open = controlledOpen ?? uncontrolledOpen;
	const [createdLink, setCreatedLink] = useState<string>();
	const [, copy] = useCopyToClipboard();
	const [state, formAction, isPending] = useActionState(createShortURL, {
		message: '',
		type: MessageType.Uninitialized
	});

	useEffect(() => {
		if (state.type === MessageType.Error) toast.error(state.message);
		else if (state.type === MessageType.Success) {
			toast.success(state.message);
			setCreatedLink(state.link);
		}
	}, [state]);

	const handleOpenChange = (value: boolean) => {
		if (!isControlled) setUncontrolledOpen(value);
		onOpenChange?.(value);
		if (!value) setCreatedLink(undefined);
	};

	const copyLink = () => {
		if (!createdLink) return;

		void copy(createdLink);
		toast.success('Short URL copied to the clipboard');
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			{isControlled ? null : (
				<DialogTrigger asChild>
					<Button className={className}>
						<Plus className="mr-2 h-4 w-4" />
						Create short URL
					</Button>
				</DialogTrigger>
			)}
			<DialogContent className="w-11/12">
				{createdLink ? (
					<>
						<DialogHeader>
							<DialogTitle>Short URL created</DialogTitle>
							<DialogDescription>
								The link lives on the YOURLS instance of this service. Copy it from below - the URL is
								not listed anywhere in this dashboard.
							</DialogDescription>
						</DialogHeader>
						<div className="grid gap-2 mb-4">
							<Label htmlFor="created-short-url">Short URL</Label>
							<div className="flex gap-2">
								<Input id="created-short-url" className="flex-1" readOnly value={createdLink} />
								<Button type="button" variant="outline" size="icon" onClick={copyLink}>
									<Copy className="h-4 w-4" />
								</Button>
							</div>
						</div>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setCreatedLink(undefined)}>
								Create another
							</Button>
							<Button type="button" onClick={() => handleOpenChange(false)}>
								Done
							</Button>
						</DialogFooter>
					</>
				) : (
					<form action={formAction}>
						<DialogHeader>
							<DialogTitle>New short URL</DialogTitle>
							<DialogDescription>
								This will create a new short URL that will redirect to the specified destination.
							</DialogDescription>
						</DialogHeader>
						<div className="grid gap-4 mb-4">
							<div className="grid gap-4 mt-4">
								<div>
									<Label htmlFor="url">Destination</Label>
									<Input
										id="url"
										name="url"
										placeholder="https://example.com"
										className="col-span-3"
										defaultValue={defaultUrl}
										required
									/>
								</div>
								<div>
									<Label htmlFor="vanity">Custom URL</Label>
									<Input
										id="vanity"
										name="vanity"
										placeholder="MySuperCustomUrl"
										className="col-span-3"
									/>
									<Callout type="warning">
										<p className="text-sm">
											You can specify a custom URL for your short URL. If the custom URL is
											already taken or you don't provide a value, a random one will be generated.
										</p>
									</Callout>
								</div>
							</div>
						</div>
						<DialogFooter>
							<Button type="submit" disabled={isPending}>
								Submit
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
