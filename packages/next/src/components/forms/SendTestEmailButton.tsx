'use client';

import { useState } from 'react';
import { Mail } from 'lucide-react';
import { toast } from 'sonner';

import request from '@/lib/request';
import { Button } from '@/components/ui/button';

/*
	The mail is sent to the address of the logged in admin, which is the account
	the settings are being edited with: no extra input is needed.
*/
export const SendTestEmailButton = () => {
	const [busy, setBusy] = useState(false);

	const sendTestEmail = async () => {
		setBusy(true);
		const { error } = await request.post({
			url: 'admin/service/settings/test-email'
		});
		setBusy(false);

		if (error) {
			toast.error(error);
			return;
		}

		toast.success('The test email was sent, check your inbox');
	};

	return (
		<Button type="button" variant="secondary" disabled={busy} onClick={() => void sendTestEmail()}>
			<Mail className="mr-2 h-4 w-4" />
			{busy ? 'Sending...' : 'Send test email to my account'}
		</Button>
	);
};
