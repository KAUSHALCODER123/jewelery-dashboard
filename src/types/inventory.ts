// Shared list/search contracts (ERP plan §4.1). Backend validates the same
// shapes in electron/inventory.cjs and document page helpers.
export type PageRequest<F = Record<string, unknown>> = F & {
  page?: number
  pageSize?: number
  sort?: string
}

export interface PageResult<T, S = Record<string, number>> {
  rows: T[]
  page: number
  pageSize: number
  total: number
  totals?: S
}

export type Selection<F = Record<string, unknown>> =
  | { mode: 'ids'; ids: number[] }
  | { mode: 'allMatching'; filters: F; excludedIds: number[] }

export const PAGE_SIZE_DEFAULT = 50
export const PAGE_SIZE_MIN = 10
export const PAGE_SIZE_MAX = 200

export function clampPageSize(n: unknown): number {
  const v = Math.trunc(Number(n)) || PAGE_SIZE_DEFAULT
  return Math.max(PAGE_SIZE_MIN, Math.min(PAGE_SIZE_MAX, v))
}

export interface StockFilters {
  status?: string
  search?: string
  itemId?: number | string
  typeId?: number | string
  designId?: number | string
  metal?: string
  category?: string
  location?: string
  shelf_tray?: string
  size?: string
  group?: string
  minWeight?: number | string
  maxWeight?: number | string
  minPurity?: number | string
  maxPurity?: number | string
  huid?: string
  printed?: string
  sort?: string
  groupBy?: string
  // T01 extensions
  supplierId?: number | string
  purchaseId?: number | string
  entryFrom?: string
  entryTo?: string
  availability?: string
}

export interface DocPageParams {
  from?: string
  to?: string
  search?: string
  status?: string
  page?: number
  pageSize?: number
}
