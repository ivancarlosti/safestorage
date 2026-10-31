'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Share2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import request from '@/lib/request';
import type { AlbumInvite, AlbumMember, AlbumShareResponse } from '@/types';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const copyInviteLink = async (path: string) => {
	const url = `${window.location.origin}${path}`;

	try {
		await navigator.clipboard.writeText(url);
		toast.success('Invite link copied to the clipboard');
	} catch {
		toast.error('The clipboard could not be used, copy the link manually');
	}
};

export function AlbumShareDialog({
	albumName,
	albumUuid
}: {
	readonly albumName: string;
	readonly albumUuid: string;
}) {
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState('');
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(false);
	const [members, setMembers] = useState<AlbumMember[]>([]);
	const [invites, setInvites] = useState<AlbumInvite[]>([]);

	const loadMembers = useCallback(async () => {
		setLoading(true);
		const { data, error } = await request.get({ url: `album/${albumUuid}/members` });
		setLoading(false);

		if (error) {
			toast.error(error);
			return;
		}

		setMembers(data.members ?? []);
		setInvites(data.invites ?? []);
	}, [albumUuid]);

	useEffect(() => {
		if (open) void loadMembers();
	}, [open, loadMembers]);

	const share = async () => {
		if (!email.trim() || busy) return;

		setBusy(true);
		const { data, error } = await request.post({
			url: `album/${albumUuid}/share`,
			body: {
				email: email.trim()
			}
		});
		setBusy(false);

		if (error) {
			toast.error(error);
			return;
		}

		const response = data as AlbumShareResponse;
		setEmail('');

		if (response.type === 'invite' && response.inviteUrl) {
			toast.success(
				response.emailSent
					? 'Invite created and emailed, the link is listed below as well'
					: 'Invite created, but the email could not be sent. Copy the link below and send it manually'
			);
		} else {
			toast.success(response.emailSent ? 'The album was shared' : 'The album was shared, but the email could not be sent');
		}

		await loadMembers();
	};

	const removeMember = async (userUuid: string) => {
		const { error } = await request.delete({ url: `album/${albumUuid}/member/${userUuid}` });

		if (error) {
			toast.error(error);
			return;
		}

		toast.success('The member was removed from the album');
		await loadMembers();
	};

	const revokeInvite = async (code: string) => {
		const { error } = await request.delete({ url: `album/${albumUuid}/invite/${code}` });

		if (error) {
			toast.error(error);
			return;
		}

		toast.success('The invite was revoked');
		await loadMembers();
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="secondary">
					<Share2 className="mr-2 h-4 w-4" />
					Share
				</Button>
			</DialogTrigger>
			<DialogContent className="w-11/12">
				<DialogHeader>
					<DialogTitle>Share album</DialogTitle>
					<DialogDescription>
						Give other people access to &quot;{albumName}&quot;. They can see the files, upload new ones and remove their
						own.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-6 py-4">
					<form
						className="flex gap-2"
						onSubmit={event => {
							event.preventDefault();
							void share();
						}}
					>
						<Input
							type="email"
							autoComplete="off"
							placeholder="person@example.com"
							value={email}
							onChange={event => setEmail(event.target.value)}
						/>
						<Button type="submit" disabled={busy || !email.trim()}>
							{busy ? 'Sharing...' : 'Share'}
						</Button>
					</form>
					<div className="grid gap-2">
						<Label>People with access</Label>
						{loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
						{!loading && members.length === 0 ? (
							<p className="text-sm text-muted-foreground">Only you have access to this album.</p>
						) : null}
						<ul className="grid gap-2">
							{members.map(member => (
								<li className="flex items-center justify-between gap-2 text-sm" key={member.uuid}>
									<span className="break-all min-w-0">{member.username}</span>
									{member.isOwner ? (
										<span className="text-xs text-muted-foreground shrink-0">Owner</span>
									) : (
										<Button
											type="button"
											size="icon"
											variant="outline"
											title="Remove access"
											onClick={() => void removeMember(member.uuid)}
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									)}
								</li>
							))}
						</ul>
					</div>

					{invites.length ? (
						<div className="grid gap-2">
							<Label>Pending invites</Label>
							<p className="text-[0.8rem] text-muted-foreground">
								These people do not have an account yet. Copy the link and send it to them, the invite expires once it is
								used.
							</p>
							<ul className="grid gap-2">
								{invites.map(invite => (
									<li className="flex items-center justify-between gap-2 text-sm" key={invite.code}>
										<span className="break-all min-w-0">{invite.email ?? invite.code}</span>
										<span className="flex shrink-0 gap-2">
											<Button
												type="button"
												size="icon"
												variant="outline"
												title="Copy invite link"
												onClick={() => void copyInviteLink(`/invite/${invite.code}`)}
											>
												<Copy className="h-4 w-4" />
											</Button>
											<Button
												type="button"
												size="icon"
												variant="outline"
												title="Revoke invite"
												onClick={() => void revokeInvite(invite.code)}
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										</span>
									</li>
								))}
							</ul>
						</div>
					) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
