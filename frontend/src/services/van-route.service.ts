import { api } from './api';
import type {
  VanRoute,
  VanRouteCreate,
  VanRouteListItem,
  VanRoutePatch,
  VanRouteStartLoadingPayload,
} from '../types';

const base = '/van-routes/';

export const vanRouteService = {
  fetchList: () => api.get<VanRouteListItem[]>(base),

  fetchById: (id: string) => api.get<VanRoute>(`${base}${id}/`),

  create: (body: VanRouteCreate) => api.post<VanRoute>(base, body),

  patch: (id: string, body: VanRoutePatch) =>
    api.patch<VanRoute>(`${base}${id}/`, body),

  delete: (id: string) => api.delete<void>(`${base}${id}/`),

  startLoading: (id: string, payload: VanRouteStartLoadingPayload) =>
    api.post<VanRoute>(`${base}${id}/start-loading/`, payload),

  confirmLoading: (id: string) =>
    api.post<VanRoute>(`${base}${id}/confirm-loading/`, {}),

  close: (id: string) => api.post<VanRoute>(`${base}${id}/close/`, {}),

  addOrders: (id: string, orderIds: string[]) =>
    api.post<VanRoute>(`${base}${id}/add-orders/`, { order_ids: orderIds }),

  removeOrders: (id: string, orderIds: string[]) =>
    api.post<VanRoute>(`${base}${id}/remove-orders/`, { order_ids: orderIds }),
};
