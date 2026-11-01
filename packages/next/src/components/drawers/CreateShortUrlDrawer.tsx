'use client';

import { useEffect, useState, useActionState } from 'react';
import { MessageType } from '@/types';
import { Copy, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useCopyToClipboard } from 'usehooks-ts';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createShortURL } from '@/actions/LinksActions';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import { Callout } from '../mdx/Callout';

export function CreateShortUrlDrawer({
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
	// Callers that open this drawer from the Actions drawer own the open state,
	// so the two vaul drawers do not stack their overlays on top of each other.
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
		<Drawer open={open} onOpenChange={handleOpenChange}>
			{isControlled ? null : (
				<DrawerTrigger asChild>
					<Button className={className}>
						<Plus className="mr-2 h-4 w-4" />
						Create short URL
					</Button>
				</DrawerTrigger>
			)}
			<DrawerContent>
				{createdLink ? (
					<>
						<div className="grid gap-1.5 py-4 px-8 text-center sm:text-left">
							<h2 className="text-lg font-semibold leading-none tracking-tight">Short URL created</h2>
							<p className="text-sm text-muted-foreground">
								The link lives on the YOURLS instance of this service. Copy it from below - the URL is
								not listed anywhere in this dashboard.
							</p>
						</div>
						<div className="grid gap-2 py-4 px-8">
							<Label htmlFor="created-short-url">Short URL</Label>
							<div className="flex gap-2">
								<Input id="created-short-url" className="flex-1" readOnly value={createdLink} />
								<Button type="button" variant="outline" size="icon" onClick={copyLink}>
									<Copy className="h-4 w-4" />
								</Button>
							</div>
						</div>
						<div className="grid gap-2 pb-6 px-8 sm:flex sm:justify-end">
							<Button type="button" variant="outline" onClick={() => setCreatedLink(undefined)}>
								Create another
							</Button>
							<Button type="button" onClick={() => handleOpenChange(false)}>
								Done
							</Button>
						</div>
					</>
				) : (
					<>
						<div className="grid gap-1.5 py-4 px-8 text-center sm:text-left">
							<h2 className="text-lg font-semibold leading-none tracking-tight">New short URL</h2>
							<p className="text-sm text-muted-foreground">
								This will create a new short URL that will redirect to the specified destination.
							</p>
						</div>

						<form action={formAction}>
							<div className="grid gap-4 py-4 px-8">
								<div className="grid gap-4">
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
												already taken, you will be asked to pick another one. If you don't
												provide a value, a random one will be generated.
											</p>
										</Callout>
									</div>
								</div>
								<Button type="submit" className="mb-4 w-full" disabled={isPending}>
									Submit
								</Button>
							</div>
						</form>
					</>
				)}
			</DrawerContent>
		</Drawer>
	);
}
