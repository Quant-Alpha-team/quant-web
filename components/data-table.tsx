"use client";

import { useState } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react";

export type TableColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right";
  width?: string;
  sticky?: "left";
  stickyOffset?: string;
  stickyEdge?: boolean;
  sortValue?: (row: T) => number | string | null | undefined;
};

type TableSort = {
  key: string;
  direction: "asc" | "desc";
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
  minWidth,
}: {
  rows: T[];
  columns: TableColumn<T>[];
  pagination?: PaginationConfig;
  minWidth?: string;
}) {
  const paginationEnabled = pagination?.enabled ?? false;
  const pageSizeOptions = pagination?.pageSizeOptions ?? [25, 50, 100];
  const defaultPageSize = pagination?.pageSize ?? pageSizeOptions[0] ?? 25;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [sort, setSort] = useState<TableSort | null>(null);

  const sortColumn = sort
    ? columns.find((column) => column.key === sort.key && column.sortValue)
    : undefined;
  const sortedRows = sortColumn?.sortValue
    ? rows
        .map((row, index) => ({ row, index }))
        .sort((left, right) => {
          const leftValue = sortColumn.sortValue?.(left.row);
          const rightValue = sortColumn.sortValue?.(right.row);
          const leftMissing =
            leftValue === null || leftValue === undefined || leftValue === "";
          const rightMissing =
            rightValue === null || rightValue === undefined || rightValue === "";

          if (leftMissing !== rightMissing) {
            return leftMissing ? 1 : -1;
          }

          let comparison = 0;
          if (!leftMissing && !rightMissing) {
            comparison =
              typeof leftValue === "number" && typeof rightValue === "number"
                ? leftValue - rightValue
                : String(leftValue).localeCompare(String(rightValue), undefined, {
                    numeric: true,
                    sensitivity: "base",
                  });
          }

          if (comparison === 0) {
            return left.index - right.index;
          }
          return sort?.direction === "desc" ? -comparison : comparison;
        })
        .map(({ row }) => row)
    : rows;

  const totalRows = rows.length;
  const totalPages = paginationEnabled
    ? Math.max(1, Math.ceil(totalRows / pageSize))
    : 1;
  const currentPage = Math.min(page, totalPages);
  const startIndex = paginationEnabled ? (currentPage - 1) * pageSize : 0;
  const endIndex = paginationEnabled
    ? Math.min(startIndex + pageSize, totalRows)
    : totalRows;
  const visibleRows = paginationEnabled
    ? sortedRows.slice(startIndex, endIndex)
    : sortedRows;

  return (
    <div className="space-y-3">
      <div
        tabIndex={minWidth ? 0 : undefined}
        aria-label={minWidth ? "Horizontally scrollable data table" : undefined}
        className={
          (minWidth ? "overflow-x-scroll " : "overflow-x-auto ") +
          "overscroll-x-contain rounded-md bg-white/[0.07] shadow-[0_18px_42px_var(--shadow)] backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
        }
      >
        <table
          style={minWidth ? { minWidth } : undefined}
          className={
            "min-w-full border-collapse text-sm " +
            (columns.some((column) => column.width) ? "table-fixed" : "")
          }
        >
          <thead className="bg-white/[0.08] text-left text-xs uppercase tracking-normal text-[var(--muted)]">
            <tr>
              {columns.map((column) => {
                const isSorted = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    aria-sort={
                      column.sortValue
                        ? isSorted
                          ? sort?.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                        : undefined
                    }
                    style={
                      column.width || column.sticky
                        ? {
                            width: column.width,
                            minWidth: column.sticky ? column.width : undefined,
                            maxWidth: column.sticky ? column.width : undefined,
                            left:
                              column.sticky === "left"
                                ? (column.stickyOffset ?? "0px")
                                : undefined,
                          }
                        : undefined
                    }
                    className={`whitespace-nowrap px-4 py-3 font-medium ${
                      column.align === "right" ? "text-right" : "text-left"
                    } ${
                      column.sticky === "left"
                        ? "sticky z-20 bg-[#30495c] " +
                          (column.stickyEdge
                            ? "shadow-[4px_0_10px_rgba(0,7,20,0.14)]"
                            : "")
                        : ""
                    }`}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSort((current) => {
                            if (current?.key !== column.key) {
                              return { key: column.key, direction: "asc" };
                            }
                            if (current.direction === "asc") {
                              return { key: column.key, direction: "desc" };
                            }
                            return null;
                          });
                          setPage(1);
                        }}
                        title={
                          isSorted
                            ? sort?.direction === "asc"
                              ? `Sort ${column.label} descending`
                              : `Clear ${column.label} sorting`
                            : `Sort ${column.label} ascending`
                        }
                        className={`inline-flex w-full cursor-pointer items-center gap-1.5 rounded-sm transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${
                          column.align === "right" ? "justify-end" : "justify-start"
                        }`}
                      >
                        <span>{column.label}</span>
                        {isSorted ? (
                          sort?.direction === "asc" ? (
                            <ChevronUp
                              className="h-3.5 w-3.5 text-cyan-300"
                              aria-hidden="true"
                            />
                          ) : (
                            <ChevronDown
                              className="h-3.5 w-3.5 text-cyan-300"
                              aria-hidden="true"
                            />
                          )
                        ) : (
                          <ArrowUpDown
                            className="h-3.5 w-3.5 opacity-50"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
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
                    style={
                      column.width || column.sticky
                        ? {
                            width: column.width,
                            minWidth: column.sticky ? column.width : undefined,
                            maxWidth: column.sticky ? column.width : undefined,
                            left:
                              column.sticky === "left"
                                ? (column.stickyOffset ?? "0px")
                                : undefined,
                          }
                        : undefined
                    }
                    className={`whitespace-nowrap px-4 py-3 ${
                      column.align === "right" ? "text-right" : "text-left"
                    } ${
                      column.sticky === "left"
                        ? "sticky z-10 bg-[#20374a] " +
                          (column.stickyEdge
                            ? "shadow-[4px_0_10px_rgba(0,7,20,0.14)]"
                            : "")
                        : ""
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
