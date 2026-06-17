export interface CostProject {
  id: string;
  name: string;
  code: string;
  color: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CostProjectWrite {
  name: string;
  code?: string;
  color?: string;
}

export type AccountingStatus = 'pending' | 'annotated' | 'exported' | 'booked';

export interface LineSplit {
  id: string | null;
  project: string | null;       // CostProject id
  projectName: string | null;
  percentage: string;           // "60", "40" etc.
  quantity: string | null;      // actual qty if split was by items
  note: string;
}

export interface LineAnnotation {
  isPrivate: boolean;
  note: string;
  splits: LineSplit[];
}

/** Returned by GET/PATCH /api/cost-allocation/invoices/<ksef_number>/annotation/ */
export interface InvoiceAnnotation {
  id: string;
  accounting_status: AccountingStatus;
  accounting_notes: string;
  exported_at: string | null;
  updated_at: string;
  /** Keys are line positions (as strings, e.g. "0", "1") */
  line_annotations: Record<string, LineAnnotation>;
}

export interface LineSplitWrite {
  project?: string | null;
  percentage: number;
  quantity?: number | null;
  note?: string;
}

/** Shape sent in PATCH body */
export interface InvoiceAnnotationWrite {
  accountingStatus?: AccountingStatus;
  accountingNotes?: string;
  lineAnnotations?: Record<string, {
    isPrivate?: boolean;
    note?: string;
    splits?: LineSplitWrite[];
  }>;
}

export const ACCOUNTING_STATUS_LABELS: Record<AccountingStatus, string> = {
  pending: 'Do opisania',
  annotated: 'Opisana',
  exported: 'Wyeksportowana',
  booked: 'Zaksięgowana',
};

export const ACCOUNTING_STATUS_COLORS: Record<AccountingStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  annotated: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  exported: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  booked: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
};
