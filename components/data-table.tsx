"use client";

import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
  resizeMinWidth?: number;
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
  const [columnWidths, setColumnWidths] = useState<Record<string, number> | null>(
    null,
  );
  const [minimumTableWidth, setMinimumTableWidth] = useState<number | null>(null);
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const columnResize = useRef<{
    key: string;
    pointerId: number;
    startX: number;
    startWidth: number;
    minimumTableWidth: number;
    widths: Record<string, number>;
  } | null>(null);
  const tableWidth = columnWidths
    ? columns.reduce((total, column) => total + columnWidths[column.key], 0)
    : null;

  function columnMinimumWidth(column: TableColumn<T>) {
    return column.resizeMinWidth ?? 104;
  }

  function totalColumnWidth(widths: Record<string, number>) {
    return columns.reduce((total, column) => total + widths[column.key], 0);
  }

  function fillMinimumTableWidth(
    widths: Record<string, number>,
    requiredWidth: number,
  ) {
    const deficit = requiredWidth - totalColumnWidth(widths);
    const fillColumn = columns.at(-1);
    if (deficit <= 0 || !fillColumn) {
      return widths;
    }
    return {
      ...widths,
      [fillColumn.key]: widths[fillColumn.key] + deficit,
    };
  }

  function constrainedColumnWidths(
    widths: Record<string, number>,
    key: string,
    requestedWidth: number,
    requiredWidth: number,
  ) {
    const columnIndex = columns.findIndex((column) => column.key === key);
    const column = columns[columnIndex];
    if (!column) {
      return widths;
    }

    const startWidth = widths[key];
    const nextWidth = Math.max(
      columnMinimumWidth(column),
      Math.round(requestedWidth),
    );
    const delta = nextWidth - startWidth;
    const nextWidths = { ...widths, [key]: nextWidth };
    const neighbor = columns[columnIndex + 1];

    if (delta > 0 && neighbor) {
      const neighborCapacity = Math.max(
        0,
        widths[neighbor.key] - columnMinimumWidth(neighbor),
      );
      nextWidths[neighbor.key] =
        widths[neighbor.key] - Math.min(delta, neighborCapacity);
    } else if (delta < 0) {
      const tableShrinkCapacity = Math.max(
        0,
        totalColumnWidth(widths) - requiredWidth,
      );
      const widthForNeighbor = Math.max(
        0,
        -delta - tableShrinkCapacity,
      );
      if (widthForNeighbor > 0) {
        if (neighbor) {
          nextWidths[neighbor.key] = widths[neighbor.key] + widthForNeighbor;
        } else {
          nextWidths[key] += widthForNeighbor;
        }
      }
    }

    return nextWidths;
  }

  function resizeMinimumWidth(
    resizeHandle: HTMLButtonElement,
    widths: Record<string, number>,
  ) {
    const viewportWidth =
      resizeHandle.closest("table")?.parentElement?.clientWidth ?? 0;
    return Math.max(
      minimumTableWidth ?? totalColumnWidth(widths),
      viewportWidth,
    );
  }

  function measureColumnWidths(
    resizeHandle: HTMLButtonElement,
  ): Record<string, number> | null {
    const table = resizeHandle.closest("table");
    if (!table) {
      return null;
    }

    const cells = Array.from(
      table.querySelectorAll<HTMLElement>("thead th[data-table-column]"),
    );
    if (cells.length !== columns.length) {
      return null;
    }

    return columns.reduce<Record<string, number>>((measured, column, index) => {
      measured[column.key] = Math.max(
        columnMinimumWidth(column),
        Math.round(cells[index].getBoundingClientRect().width),
      );
      return measured;
    }, {});
  }

  function startColumnResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    column: TableColumn<T>,
  ) {
    if (event.button !== 0) {
      return;
    }

    const measuredWidths =
      columnWidths ?? measureColumnWidths(event.currentTarget);
    if (!measuredWidths) {
      return;
    }
    const requiredWidth = resizeMinimumWidth(
      event.currentTarget,
      measuredWidths,
    );
    const widths = fillMinimumTableWidth(measuredWidths, requiredWidth);

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    columnResize.current = {
      key: column.key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widths[column.key],
      minimumTableWidth: requiredWidth,
      widths,
    };
    setMinimumTableWidth(requiredWidth);
    setColumnWidths(widths);
    setResizingColumn(column.key);
  }

  function moveColumnResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = columnResize.current;
    if (!resize || resize.pointerId !== event.pointerId) {
      return;
    }

    const column = columns.find((candidate) => candidate.key === resize.key);
    if (!column) {
      return;
    }

    event.preventDefault();
    setColumnWidths(
      constrainedColumnWidths(
        resize.widths,
        resize.key,
        resize.startWidth + event.clientX - resize.startX,
        resize.minimumTableWidth,
      ),
    );
  }

  function finishColumnResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (columnResize.current?.pointerId !== event.pointerId) {
      return;
    }
    columnResize.current = null;
    setResizingColumn(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resizeColumnWithKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    column: TableColumn<T>,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    const measuredWidths =
      columnWidths ?? measureColumnWidths(event.currentTarget);
    if (!measuredWidths) {
      return;
    }
    const requiredWidth = resizeMinimumWidth(
      event.currentTarget,
      measuredWidths,
    );
    const widths = fillMinimumTableWidth(measuredWidths, requiredWidth);

    event.preventDefault();
    event.stopPropagation();
    const delta =
      (event.shiftKey ? 40 : 12) * (event.key === "ArrowRight" ? 1 : -1);
    setMinimumTableWidth(requiredWidth);
    setColumnWidths(
      constrainedColumnWidths(
        widths,
        column.key,
        widths[column.key] + delta,
        requiredWidth,
      ),
    );
  }

  function columnStyle(column: TableColumn<T>, columnIndex: number) {
    const resizedWidth = columnWidths?.[column.key];
    const width =
      resizedWidth === undefined ? column.width : `${resizedWidth}px`;
    const stickyLeft =
      column.sticky === "left"
        ? columnWidths
          ? `${columns
              .slice(0, columnIndex)
              .reduce(
                (total, previous) => total + columnWidths[previous.key],
                0,
              )}px`
          : (column.stickyOffset ?? "0px")
        : undefined;

    if (!width && !stickyLeft) {
      return undefined;
    }
    return {
      width,
      minWidth: resizedWidth === undefined && !column.sticky ? undefined : width,
      maxWidth: resizedWidth === undefined && !column.sticky ? undefined : width,
      left: stickyLeft,
    };
  }

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
        tabIndex={minWidth || columnWidths ? 0 : undefined}
        aria-label={
          minWidth || columnWidths ? "Horizontally scrollable data table" : undefined
        }
        className={
          (minWidth ? "overflow-x-scroll " : "overflow-x-auto ") +
          "overscroll-x-contain rounded-md bg-white/[0.07] shadow-[0_18px_42px_var(--shadow)] backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
        }
      >
        <table
          style={
            tableWidth === null
              ? minWidth
                ? { minWidth }
                : undefined
              : { width: `${tableWidth}px`, minWidth: `${tableWidth}px` }
          }
          className={
            (columnWidths ? "" : "min-w-full ") +
            "border-collapse text-sm " +
            (columnWidths || columns.some((column) => column.width)
              ? "table-fixed"
              : "")
          }
        >
          {columnWidths ? (
            <colgroup>
              {columns.map((column) => (
                <col
                  key={column.key}
                  style={{ width: `${columnWidths[column.key]}px` }}
                />
              ))}
            </colgroup>
          ) : null}
          <thead className="bg-white/[0.08] text-left text-xs uppercase tracking-normal text-[var(--muted)]">
            <tr>
              {columns.map((column, columnIndex) => {
                const isSorted = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    data-table-column={column.key}
                    aria-sort={
                      column.sortValue
                        ? isSorted
                          ? sort?.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                        : undefined
                    }
                    style={columnStyle(column, columnIndex)}
                    className={`overflow-hidden whitespace-nowrap px-4 py-3 font-medium ${
                      column.align === "right" ? "text-right" : "text-left"
                    } ${
                      column.sticky === "left"
                        ? "sticky z-40 bg-[#30495c] " +
                          (column.stickyEdge
                            ? "shadow-[4px_0_10px_rgba(0,7,20,0.14)]"
                            : "")
                        : "relative z-0"
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
                        className={`inline-flex w-full min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden rounded-sm pr-2 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${
                          column.align === "right" ? "justify-end" : "justify-start"
                        }`}
                      >
                        <span className="min-w-0 truncate">{column.label}</span>
                        {isSorted ? (
                          sort?.direction === "asc" ? (
                            <ChevronUp
                              className="h-3.5 w-3.5 shrink-0 text-cyan-300"
                              aria-hidden="true"
                            />
                          ) : (
                            <ChevronDown
                              className="h-3.5 w-3.5 shrink-0 text-cyan-300"
                              aria-hidden="true"
                            />
                          )
                        ) : (
                          <ArrowUpDown
                            className="h-3.5 w-3.5 shrink-0 opacity-50"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    ) : (
                      <span className="block truncate pr-2">{column.label}</span>
                    )}
                    {columnIndex < columns.length - 1 ? (
                      <button
                        type="button"
                        aria-label={`Resize ${column.label} column. Drag, or use the left and right arrow keys.`}
                      title={`Resize ${column.label} column`}
                      onPointerDown={(event) => startColumnResize(event, column)}
                      onPointerMove={moveColumnResize}
                      onPointerUp={finishColumnResize}
                      onPointerCancel={finishColumnResize}
                      onLostPointerCapture={(event) => {
                        if (columnResize.current?.pointerId === event.pointerId) {
                          columnResize.current = null;
                          setResizingColumn(null);
                        }
                      }}
                      onKeyDown={(event) =>
                        resizeColumnWithKeyboard(event, column)
                      }
                      className="group/resize absolute right-0 top-0 z-10 flex h-full w-2 cursor-col-resize touch-none select-none items-center justify-end focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300"
                    >
                      <span
                        className={
                          "h-3/5 w-px transition-colors " +
                          (resizingColumn === column.key
                            ? "bg-cyan-300"
                            : "bg-white/20 group-hover/resize:bg-cyan-300/80")
                        }
                      />
                      </button>
                    ) : null}
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
                {columns.map((column, columnIndex) => (
                  <td
                    key={column.key}
                    style={columnStyle(column, columnIndex)}
                    className={`overflow-hidden whitespace-nowrap px-4 py-3 ${
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
                    <div className="min-w-0 overflow-hidden text-ellipsis">
                      {column.render(row)}
                    </div>
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
