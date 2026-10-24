'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

type CheckboxProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'onChange' | 'type'> & {
	/**
	 * Shows the "some but not all" state. Mirrors the native `indeterminate`
	 * property, which can only be set through the DOM.
	 */
	indeterminate?: boolean;
	onCheckedChange?(checked: boolean): void;
};

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
	({ className, indeterminate = false, onCheckedChange, ...props }, ref) => {
		const innerRef = React.useRef<HTMLInputElement>(null);

		React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

		/*
			Synced after every render instead of only when `indeterminate` changes:
			clicking an indeterminate checkbox clears the native flag on its own,
			so an effect keyed on the prop would leave the DOM out of sync when the
			state it represents did not change (e.g. selecting one row of many).
		*/
		React.useEffect(() => {
			if (innerRef.current) {
				innerRef.current.indeterminate = indeterminate;
			}
		});

		return (
			<input
				{...props}
				ref={innerRef}
				role="checkbox"
				type="checkbox"
				className={cn(
					'h-4 w-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50',
					className
				)}
				onChange={event => onCheckedChange?.(event.target.checked)}
			/>
		);
	}
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
