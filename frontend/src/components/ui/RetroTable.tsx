import React from 'react';
import clsx from 'clsx';

export interface RetroTableProps<T> {
  columns: { key: keyof T | string; header: React.ReactNode; className?: string; render?: (row: T) => React.ReactNode }[];
  data: T[];
  keyExtractor: (row: T, index: number) => React.Key;
  className?: string;
  tableClassName?: string;
}

export function RetroTable<T>({ columns, data, keyExtractor, className, tableClassName }: RetroTableProps<T>) {
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className={clsx('min-w-full border-separate border-spacing-0', tableClassName)}>
        <thead>
          <tr>
            {columns.map((col, idx) => (
              <th key={idx} className="text-left px-4 py-2 border-b-2 border-black dark:border-retro-ink-dark bg-yellow-200 dark:bg-yellow-600 font-semibold text-retro-ink dark:text-retro-ink-dark">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rIdx) => (
            <tr key={keyExtractor(row, rIdx)} className="odd:bg-white dark:odd:bg-retro-surface-dark even:bg-neutral-50 dark:even:bg-neutral-800">
              {columns.map((col, cIdx) => (
                <td key={cIdx} className={clsx('px-4 py-2 border-b border-neutral-300 dark:border-neutral-600 text-retro-ink dark:text-retro-ink-dark', col.className)}>
                  {col.render ? col.render(row) : ((row as any)[col.key as any] as React.ReactNode)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface RetroPaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export const RetroPagination: React.FC<RetroPaginationProps> = ({ page, pageCount, onPageChange, className }) => {
  const canPrev = page > 1;
  const canNext = page < pageCount;
  return (
    <div className={clsx('flex items-center justify-between mt-3', className)}>
      <button
        className={clsx('retro-btn-base px-3 py-1 text-sm', canPrev ? 'bg-white dark:bg-retro-surface-dark dark:text-retro-ink-dark' : 'bg-neutral-200 dark:bg-neutral-700 opacity-60 cursor-not-allowed')}
        onClick={() => canPrev && onPageChange(page - 1)}
        disabled={!canPrev}
      >
        Prev
      </button>
      <span className="text-sm font-monoRetro text-retro-ink dark:text-retro-ink-dark">Page {page} of {pageCount}</span>
      <button
        className={clsx('retro-btn-base px-3 py-1 text-sm', canNext ? 'bg-white dark:bg-retro-surface-dark dark:text-retro-ink-dark' : 'bg-neutral-200 dark:bg-neutral-700 opacity-60 cursor-not-allowed')}
        onClick={() => canNext && onPageChange(page + 1)}
        disabled={!canNext}
      >
        Next
      </button>
    </div>
  );
};
