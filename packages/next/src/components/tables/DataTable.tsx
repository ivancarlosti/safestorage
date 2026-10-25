'use client';

import type { PropsWithChildren } from 'react';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { RowData, Table as TableType } from '@tanstack/react-table';
import { flexRender } from '@tanstack/react-table';
import { cn } from '@/lib/utils';

declare module '@tanstack/table-core' {
	interface ColumnMeta<TData extends RowData, TValue> {
		/** Extra classes for every body cell of this column (e.g. compact padding). */
		className?: string;
	}
}

export const DataTable = ({
	table,
	showColumnSelector = false,
	mobileHiddenColumns = []
}: PropsWithChildren<{
	/**
	 * Column ids dropped below the `md` breakpoint. They are hidden with
	 * `hidden md:table-cell` instead of TanStack's `columnVisibility` so the
	 * rendered markup does not depend on a media query being resolved first.
	 */
	readonly mobileHiddenColumns?: readonly string[];
	readonly showColumnSelector?: boolean;
	readonly table: TableType<any>;
}>) => {
	const isHiddenOnMobile = (columnId: string) => mobileHiddenColumns.includes(columnId);
	// Columns hidden by the media query are still part of the table model.
	const visibleColumnCount = table.getVisibleLeafColumns().filter(column => !isHiddenOnMobile(column.id)).length;

	return (
		<>
			{showColumnSelector ? (
				<div className="flex items-center py-4">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" className="ml-auto">
								Columns
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{table
								.getAllColumns()
								.filter(column => column.getCanHide())
								.map(column => {
									return (
										<DropdownMenuCheckboxItem
											key={column.id}
											className="capitalize"
											checked={column.getIsVisible()}
											onCheckedChange={value => column.toggleVisibility(Boolean(value))}
										>
											{column.id}
										</DropdownMenuCheckboxItem>
									);
								})}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			) : null}
			<div className="rounded-md border bg-background-transparent">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map(headerGroup => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map(header => {
									return (
										<TableHead
											key={header.id}
											className={cn(isHiddenOnMobile(header.column.id) && 'hidden md:table-cell')}
										>
											{header.isPlaceholder
												? null
												: flexRender(header.column.columnDef.header, header.getContext())}
										</TableHead>
									);
								})}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows?.length ? (
							table.getRowModel().rows.map(row => (
								<TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
									{row.getVisibleCells().map(cell => (
										<TableCell
											key={cell.id}
											className={cn(
												cell.column.columnDef.meta?.className,
												isHiddenOnMobile(cell.column.id) && 'hidden md:table-cell'
											)}
										>
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell colSpan={visibleColumnCount} className="h-24 text-center">
									No results.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
		</>
	);
};
