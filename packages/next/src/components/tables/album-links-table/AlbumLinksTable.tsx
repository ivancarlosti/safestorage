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
import { ArrowUpRightFromSquare } from 'lucide-react';
import { DataTable } from '../DataTable';
import type { AlbumLink } from '@/types';
import { DeleteLinkButton } from './DeleteLinkButton';
import { AlbumLinksToggleAction } from './AlbumLinksToggleAction';
import { LinkSettingsDialog } from './LinkSettingsDialog';

const columnHelper = createColumnHelper<AlbumLink>();
const columns = [
	columnHelper.accessor(row => row.views, {
		id: 'views',
		header: 'Views'
	}),
	columnHelper.display({
		id: 'link',
		header: 'Link',
		cell: props => (
			<a
				href={`/a/${props.row.original.identifier}`}
				target="_blank"
				rel="noopener noreferrer"
				className="link inline-flex items-center"
			>
				{props.row.original.identifier} <ArrowUpRightFromSquare className="w-3 h-3 ml-1" />
			</a>
		)
	}),
	columnHelper.display({
		id: 'access',
		header: 'Access',
		cell: props => (
			<div className="flex flex-col text-xs text-muted-foreground">
				{props.row.original.allowUploads ? <span>Uploads</span> : null}
				{props.row.original.hideFiles ? <span>Drop-only</span> : null}
				{!props.row.original.allowUploads && !props.row.original.hideFiles ? <span>View only</span> : null}
				<span>
					{props.row.original.viewMode === 'thumbs'
						? 'Thumbnails'
						: props.row.original.viewMode === 'list'
							? 'List'
							: 'Album default'}
				</span>
			</div>
		)
	}),
	columnHelper.display({
		id: 'enabled',
		header: 'Enabled',
		cell: props => (
			<AlbumLinksToggleAction
				key={props.row.original.uuid}
				uuid={props.row.original.uuid}
				albumUuid={props.row.original.albumUuid}
				initialEnabled={props.row.original.enabled}
			/>
		)
	}),
	columnHelper.display({
		id: 'actions',
		header: '',
		cell: props => (
			<div className="flex justify-end gap-2">
				<LinkSettingsDialog link={props.row.original} />
				<DeleteLinkButton uuid={props.row.original.uuid} albumUuid={props.row.original.albumUuid} />
			</div>
		)
	})
];

export const AlbumLinksTable = ({ data = [] }: PropsWithChildren<{ readonly data?: any | undefined }>) => {
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

	return <DataTable table={table} columns={columns} />;
};
