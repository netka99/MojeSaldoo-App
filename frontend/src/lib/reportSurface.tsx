import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Page canvas for lists and reports. See design.md, „Listy i raporty”. */
export const reportPageClass = 'min-h-full bg-[#F2F2F7] pb-16';
export const reportInnerClass = 'mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pt-8 sm:px-6';
export const reportTitleClass = 'text-xl font-bold tracking-tight text-slate-900';
export const reportSubtitleClass = 'mt-1 text-xs text-slate-500';
export const reportCardClass = 'border border-slate-200 bg-white shadow-none md:rounded-3xl';
export const reportSectionTitleClass = 'text-sm font-semibold leading-none text-slate-900';
export const reportThClass =
  'whitespace-nowrap border-b border-slate-200 bg-white px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500';
export const reportButtonClass =
  'rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';
export const reportPresetClass = 'rounded-2xl border px-3 py-1.5 text-sm font-medium transition-colors';
export const reportLabelClass = 'mb-1.5 block text-sm font-medium text-slate-800';
export const reportRowClass = 'border-b border-slate-100 transition-colors hover:bg-slate-50';
export const reportTableClass = 'w-full border-collapse text-sm font-normal';
export const reportTdClass = 'px-3 py-3 text-sm font-normal text-slate-600';
export const reportTdMutedClass = 'whitespace-nowrap px-3 py-3 text-sm font-normal tabular-nums text-slate-500';
export const reportTdMoneyClass = 'whitespace-nowrap px-3 py-3 text-right text-sm font-semibold tabular-nums text-slate-900';
export const reportLinkClass = 'text-sm font-semibold text-primary hover:underline';
export const reportExpandThClass = 'w-8 border-b border-slate-200 bg-white px-2 py-3';

const reportDateFormat = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });

export function formatReportDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return reportDateFormat.format(d);
}

export function reportStatusClass(status: string): string {
  if (status === 'paid') return 'text-sm font-medium text-emerald-700';
  if (status === 'overdue') return 'text-sm font-medium text-red-600';
  if (status === 'cancelled') return 'text-sm font-medium text-slate-400';
  return 'text-sm font-medium text-amber-700';
}

export function ReportExpandIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={cn('h-4 w-4 text-slate-500 transition-transform', open && 'rotate-90')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Pastel status cards. Middle saturation: stronger than border-*-200, softer than a dark outline. */
export const statusFill = {
  gold: '#FFFBEB',
  green: '#F0FDF4',
  red: '#FEF2F2',
  orange: '#FFF7ED',
  purple: '#FAF5FF',
} as const;

export const statusBorder = {
  gold: '#F3D072',
  green: '#A5E1BD',
  red: '#F2B6B6',
  orange: '#FDBA74',
  purple: '#D8B4FE',
  redStrong: '#E7A3A3',
} as const;

export const statusGoldClass = 'border-[#F3D072] bg-[#FFFBEB]';
export const statusGreenClass = 'border-[#A5E1BD] bg-[#F0FDF4]';
export const statusRedClass = 'border-[#F2B6B6] bg-[#FEF2F2]';
export const statusOrangeClass = 'border-[#FDBA74] bg-[#FFF7ED]';
export const statusPurpleClass = 'border-[#D8B4FE] bg-[#FAF5FF]';

export function ReportShell({ children }: { children: ReactNode }) {
  return (
    <div className={reportPageClass}>
      <div className={reportInnerClass}>{children}</div>
    </div>
  );
}
