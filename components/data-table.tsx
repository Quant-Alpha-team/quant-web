"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type TableColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right";
  width?: string;
};

type PaginationConfig = {
  enabled?: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
};

const pagerButtonClass =
  "inline-flex h-9 min-w-9 items-center justify-center rounded-md bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.09))] px-3 text-sm font-semibold text-[var(--foreground)] shadow-[0_10px_20px_rgba(0,5,18,0.18)] transition hover:-translate-y-px hover:bg-white/[0.18] disabled:cursor-not-allowed disabled:bg-white/[0.05] disabled:text-[var(--muted)] disabled:shadow-none disabled:hover:translate-y-0";

export function DataTable<T>({
  rows,
  columns,
  pagination,
}: {
  rows: T[];
  columns: TableColumn<T>[];
  pagination?: PaginationConfig;
}) {
  const paginationEnabled = pagination?.enabled ?? false;
  const pageSizeOptions = pagination?.pageSizeOptions ?? [25, 50, 100];
  const defaultPageSize = pagination?.pageSize ?? pageSizeOptions[0] ?? 25;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const totalRows = rows.length;
  const totalPages = paginationEnabled
    ? Math.max(1, Math.ceil(totalRows / pageSize))
    : 1;
  const currentPage = Math.min(page, totalPages);
  const startIndex = paginationEnabled ? (currentPage - 1) * pageSize : 0;
  const endIndex = paginationEnabled
    ? Math.min(startIndex + pageSize, totalRows)
    : totalRows;
  const visibleRows = paginationEnabled ? rows.slice(startIndex, endIndex) : rows;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md bg-white/[0.07] shadow-[0_18px_42px_var(--shadow)] backdrop-blur-xl">
        <table
          className={
            "min-w-full border-collapse text-sm " +
            (columns.some((column) => column.width) ? "table-fixed" : "")
          }
        >
          <thead className="bg-white/[0.08] text-left text-xs uppercase tracking-normal text-[var(--muted)]">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  style={column.width ? { width: column.width } : undefined}
                  className={`whitespace-nowrap px-4 py-3 font-medium ${
                    column.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-t border-white/[0.08] text-[var(--foreground)]"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`whitespace-nowrap px-4 py-3 ${
                      column.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {paginationEnabled && totalRows > 0 ? (
        <div className="flex flex-col gap-3 rounded-md bg-white/[0.05] px-3 py-3 text-xs text-[var(--muted)] shadow-[0_12px_30px_rgba(0,5,18,0.16)] backdrop-blur xl:flex-row xl:items-center xl:justify-between">
          <div className="font-mono uppercase tracking-normal">
            Showing {startIndex + 1}-{endIndex} of {totalRows}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-md bg-white/[0.05] px-2.5 py-1.5 text-[11px] uppercase tracking-normal text-[var(--muted-strong)]">
              Rows
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                className="h-7 rounded-md bg-white/[0.08] px-2 text-xs text-[var(--foreground)] outline-none"
              >
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setPage((current) => Math.max(1, Math.min(currentPage, current) - 1))
                }
                disabled={currentPage <= 1}
                className={pagerButtonClass}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <span className="rounded-md bg-white/[0.05] px-3 py-2 font-mono text-[11px] uppercase tracking-normal text-[var(--muted-strong)]">
                Page {currentPage} / {totalPages}
              </span>

              <button
                type="button"
                onClick={() =>
                  setPage((current) =>
                    Math.min(totalPages, Math.max(currentPage, current) + 1),
                  )
                }
                disabled={currentPage >= totalPages}
                className={pagerButtonClass}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
