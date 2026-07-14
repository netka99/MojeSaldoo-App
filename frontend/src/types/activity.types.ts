export type ActivityStatus = 'success' | 'error' | 'warning';

export interface ActivityErrorInfo {
  title: string;
  description: string;
  action_hint: string;
  action_url: string | null;
}

export interface ActivityEntry {
  id: number;
  action: string;
  action_label: string;
  status: ActivityStatus;
  object_type: string;
  object_id: string;
  error_code: string;
  error_info: ActivityErrorInfo | null;
  created_at: string;
  user_display: string | null;
}

export interface ActivityLogResponse {
  results: ActivityEntry[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}
