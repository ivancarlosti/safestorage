'use client';

import type { ColumnFiltersState, SortingState, VisibilityState } from '@tanstack/react-table';
import {
	createColumnHelper,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	useReactTable
} from '@tanstack/react-table';
import { useState, type PropsWithChildren } from 'react';
import { DataTable } from '../DataTable';
import type { Invite } from '@/types';
import { InvitesConfirmationAction } from './InvitesConfirmationAction';
import Link from 'next/link';
import { getDate } from '@/lib/time';

const columnHelper = createColumnHelper<Invite>();
const columns = [
	columnHelper.accessor(row => row.code, {
		id: 'code',
		header: 'Code',
		cell(props) {
			return (
				<Link href={`/invite/${props.row.original.code}`} className="link">
					{props.row.original.code}
				</Link>
			);
		}
	}),
	columnHelper.accessor(row => row.album?.name ?? '', {
		id: 'album',
		header: 'Album / Email',
		cell(props) {
			const { album, email } = props.row.original;

			if (!album && !email) return <span className="text-muted-foreground">—</span>;

			return (
				<div className="flex max-w-48 flex-col gap-0.5">
					{album ? (
						<Link href={`/dashboard/albums/${album.uuid}`} className="link inline-block min-w-0 break-all">
							{album.name}
						</Link>
					) : null}
					{email ? <span className="text-xs text-muted-foreground break-all">{email}</span> : null}
				</div>
			);
		}
	}),
	columnHelper.accessor(row => (row.used ? 'Used' : 'Available'), {
		id: 'status',
		header: 'Status'
	}),
	columnHelper.accessor(row => row.createdBy.username, {
		id: 'createdBy',
		header: 'Created By',
		cell(props) {
			return (
				<Link
					href={`/dashboard/admin/users/${props.row.original.createdBy.uuid}`}
					className="link inline-block max-w-48 wrap-anywhere"
				>
					{props.row.original.createdBy.username}
				</Link>
			);
		}
	}),
	columnHelper.accessor(row => getDate(row.createdAt), {
		id: 'createdAt',
		header: 'Created At'
	}),
	columnHelper.accessor(row => row.usedBy.username, {
		id: 'claimedBy',
		header: 'Claimed By',
		cell(props) {
			return props.row.original.usedBy.uuid ? (
				<Link
					href={`/dashboard/admin/users/${props.row.original.usedBy.uuid}`}
					className="link inline-block max-w-48 wrap-anywhere"
				>
					{props.row.original.usedBy.username}
				</Link>
			) : (
				'N/A'
			);
		}
	}),
	columnHelper.accessor(row => (row.editedAt ? getDate(row.editedAt) : 'N/A'), {
		id: 'claimedAt',
		header: 'Claimed At'
	}),
	columnHelper.display({
		id: 'actions',
		header: '',
		cell: props =>
			props.row.original.used ? null : (
				<div className="flex justify-end">
					<InvitesConfirmationAction code={props.row.original.code} />
				</div>
			)
	})
];

export const InvitesTable = ({ data = [] }: PropsWithChildren<{ readonly data?: any | undefined }>) => {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
	const table = useReactTable({
		data,
		columns,
		getCoreRowModel: getCoreRowModel(),
		onSortingChange: setSorting,
		getSortedRowModel: getSortedRowModel(),
		onColumnFiltersChange: setColumnFilters,
		getFilteredRowModel: getFilteredRowModel(),
		onColumnVisibilityChange: setColumnVisibility,
		state: {
			sorting,
			columnFilters,
			columnVisibility
		}
	});

	return <DataTable table={table} />;
};
