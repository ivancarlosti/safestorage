'use client';

import type {
	ColumnFiltersState,
	OnChangeFn,
	RowData,
	RowSelectionState,
	SortingState,
	VisibilityState
} from '@tanstack/react-table';
import {
	createColumnHelper,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	useReactTable
} from '@tanstack/react-table';
import { useCallback, useMemo, useState, type PropsWithChildren } from 'react';
import type { FilePropsType, FileWithIndex } from '@/types';
import { ArrowDownToLineIcon, ArrowUpDown, ArrowUpRightFromSquare } from 'lucide-react';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { DataTable } from '../DataTable';
import { FileInformationDialogActions } from '@/components/FileInformationDialogActions';
import { formatBytes } from '@/lib/file';
import { FileThumbnail } from '@/components/FileThumbnail';
import { selectedFilesAtom } from '@/lib/atoms/selectedFiles';
import { useAtom } from 'jotai';
import Link from 'next/link';

declare module '@tanstack/table-core' {
	interface TableMeta<TData extends RowData> {
		isAdmin?: boolean;
		type?: FilePropsType;
	}
}

const columnHelper = createColumnHelper<FileWithIndex>();
const columns = [
	columnHelper.display({
		id: 'select',
		header: ({ table }) => (
			<Checkbox
				aria-label="Select all files on this page"
				checked={table.getIsAllPageRowsSelected()}
				indeterminate={table.getIsSomePageRowsSelected()}
				onCheckedChange={checked => table.toggleAllPageRowsSelected(checked)}
			/>
		),
		cell: props => (
			<Checkbox
				aria-label={`Select ${props.row.original.original}`}
				checked={props.row.getIsSelected()}
				disabled={!props.row.getCanSelect()}
				onCheckedChange={checked => props.row.toggleSelected(checked)}
			/>
		),
		enableHiding: false,
		enableSorting: false,
		meta: {
			className: 'py-2'
		}
	}),
	columnHelper.accessor(row => row.thumb, {
		id: 'thumbnail',
		header: 'Preview',
		meta: {
			className: 'py-2'
		},
		cell: props => (
			<FileThumbnail file={props.row.original} isTableView type={props.table.options.meta?.type ?? 'uploads'} />
		)
	}),
	columnHelper.accessor(row => row.url, {
		id: 'link',
		header: 'Link',
		cell: props => (
			<a href={props.row.original.url} className="text-blue-500 underline inline-flex items-center">
				{props.row.original.name} <ArrowUpRightFromSquare className="w-3 h-3 ml-1" />
			</a>
		)
	}),
	columnHelper.accessor(row => row.original, {
		id: 'original',
		header: 'Original',
		cell: props => (
			<a
				href={`/api/file/${props.row.original.uuid}/download`}
				className="text-blue-500 underline inline-flex items-center break-all"
			>
				{props.row.original.original} <ArrowDownToLineIcon className="w-4 h-4 ml-1" />
			</a>
		)
	}),
	columnHelper.accessor(row => row.user, {
		id: 'user',
		header: 'Owner',
		enableHiding: true,
		cell: props => (
			<Link
				href={`/dashboard/admin/users/${props.row.original.user?.uuid}`}
				className="text-blue-500 underline inline-flex items-center"
			>
				{props.row.original.user?.username}
			</Link>
		)
	}),
	columnHelper.accessor(row => row.albums, {
		id: 'album',
		header: 'Album',
		enableHiding: true,
		cell: props => {
			const albums = props.getValue();

			if (!albums?.length) {
				return <span className="text-muted-foreground">—</span>;
			}

			return (
				<div className="flex flex-col gap-0.5">
					{albums.map(album => (
						<span key={album.uuid} className="whitespace-nowrap">
							{album.name}
							{album.user ? (
								<Link
									href={`/dashboard/admin/users/${album.user.uuid}`}
									className="text-xs text-muted-foreground ml-1 hover:underline"
								>
									({album.user.username})
								</Link>
							) : (
								<span className="text-xs text-muted-foreground ml-1">(unknown owner)</span>
							)}
						</span>
					))}
				</div>
			);
		}
	}),
	columnHelper.accessor(row => row.size, {
		id: 'size',
		header: ({ column }) => {
			return (
				<Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
					Size
					<ArrowUpDown className="ml-2 h-4 w-4" />
				</Button>
			);
		},
		cell: props => <span>{formatBytes(props.getValue())}</span>
	}),
	columnHelper.accessor(row => row.createdAt, {
		id: 'created',
		header: ({ column }) => {
			return (
				<Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
					Created
					<ArrowUpDown className="ml-2 h-4 w-4" />
				</Button>
			);
		},
		cell: props => <span>{new Date(props.getValue()).toLocaleDateString()}</span>
	}),
	columnHelper.display({
		id: 'actions',
		header: '',
		cell: props => (
			<FileInformationDialogActions
				file={props.row.original}
				type={props.table.options.meta?.type ?? 'uploads'}
			/>
		)
	})
];

export const FilesTable = ({
	data = [],
	type
}: PropsWithChildren<{ readonly data?: FileWithIndex[] | undefined; readonly type: FilePropsType }>) => {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	// Only administrators list files that belong to other accounts, so the
	// `Owner` and `Album` columns are pointless everywhere else.
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
		album: type === 'admin',
		user: type === 'admin'
	});
	const [selectedFiles, setSelectedFiles] = useAtom(selectedFilesAtom);

	const rowSelection = useMemo<RowSelectionState>(() => {
		const selection: RowSelectionState = {};
		for (const file of selectedFiles) {
			selection[file.uuid] = true;
		}

		return selection;
	}, [selectedFiles]);

	const handleRowSelectionChange = useCallback<OnChangeFn<RowSelectionState>>(
		updater => {
			const nextSelection = typeof updater === 'function' ? updater(rowSelection) : updater;
			// The floating selection toolbar works with file objects, not with row ids.
			setSelectedFiles(data.filter(file => nextSelection[file.uuid]));
		},
		[data, rowSelection, setSelectedFiles]
	);

	const table = useReactTable({
		data,
		columns,
		getCoreRowModel: getCoreRowModel(),
		getRowId: row => row.uuid,
		enableRowSelection: row => !row.original.quarantine || type === 'quarantine',
		onRowSelectionChange: handleRowSelectionChange,
		onSortingChange: setSorting,
		getSortedRowModel: getSortedRowModel(),
		onColumnFiltersChange: setColumnFilters,
		getFilteredRowModel: getFilteredRowModel(),
		onColumnVisibilityChange: setColumnVisibility,
		state: {
			sorting,
			columnFilters,
			columnVisibility,
			rowSelection
		},
		meta: {
			type
		}
	});

	return <DataTable table={table} columns={columns} />;
};
