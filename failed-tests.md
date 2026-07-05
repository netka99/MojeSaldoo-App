# Failed Tests Report

**Date:** 2026-07-02  
**Branch:** feat-containers  
**Test run:** `make test` (podman compose, PostgreSQL backend)  
**Result:** 28 failed, 412 passed (440 total)

---

## Root Cause

All 28 failures share a single error:

```
psycopg2.errors.FeatureNotSupported: FOR UPDATE cannot be applied to the nullable side of an outer join
django.db.utils.NotSupportedError: FOR UPDATE cannot be applied to the nullable side of an outer join
```

PostgreSQL forbids `SELECT … FOR UPDATE` on rows that are reached via a `LEFT OUTER JOIN` (i.e. a nullable foreign key). Every failing test triggers a code path that calls `select_for_update()` combined with `select_related()` on nullable relations of `DeliveryDocument` (e.g. `from_warehouse`, `to_warehouse`, `from_supplier`, `to_customer`, `order`).

These queries worked under SQLite (the previous test backend) but fail under PostgreSQL. The fix is to add `of=("deliverydocument",)` to the `select_for_update()` calls so the lock is applied only to the main table, not to joined tables — or to split the lock from the related-object fetch into two separate queries.

**Affected files:**
- `backend/apps/delivery/views.py` — lines 322, 682, 745
- `backend/apps/delivery/services.py` — multiple `select_for_update()` calls combined with `select_related()`

---

## Failed Tests

All failures are in `apps/delivery/tests.py`.

### DeliveryDocumentAPITests (16 tests)

| # | Test |
|---|------|
| 1 | `test_post_complete_empty_items_uses_planned_quantities_for_stock` |
| 2 | `test_post_complete_exceeds_ordered_quantity_returns_400` |
| 3 | `test_post_complete_insufficient_reserved_returns_400` |
| 4 | `test_post_complete_marks_order_delivered_when_fully_delivered` |
| 5 | `test_post_complete_missing_productstock_returns_400` |
| 6 | `test_post_complete_returns_exceed_actual_returns_400` |
| 7 | `test_post_complete_sale_only_one_sale_movement_and_stock` |
| 8 | `test_post_complete_second_wz_consumes_remaining_reserved` |
| 9 | `test_post_complete_twice_returns_400` |
| 10 | `test_post_complete_two_distinct_products_updates_both_stocks` |
| 11 | `test_post_complete_two_lines_same_product_insufficient_reserved_aggregate` |
| 12 | `test_post_complete_two_lines_same_product_two_sale_movements` |
| 13 | `test_post_complete_two_products_one_short_rolls_back_all` |
| 14 | `test_post_complete_updates_lines_and_order` |
| 15 | `test_post_complete_without_from_warehouse_returns_400` |
| 16 | `test_post_save_and_start_delivery_transitions` |

### PZFlowAPITests (6 tests)

| # | Test |
|---|------|
| 17 | `test_complete_pz_accumulates_stock_on_second_pz` |
| 18 | `test_complete_pz_changes_status_to_delivered` |
| 19 | `test_complete_pz_creates_purchase_stock_movement` |
| 20 | `test_complete_pz_credits_stock_to_to_warehouse` |
| 21 | `test_complete_pz_twice_returns_400` |
| 22 | `test_complete_pz_with_quantity_actual_override` |

### FifoStockBatchDeductionOnWZTests (4 tests)

| # | Test |
|---|------|
| 23 | `test_wz_complete_consumes_oldest_batch_first` |
| 24 | `test_wz_complete_decrements_single_batch` |
| 25 | `test_wz_complete_full_sale_zeroes_batch` |
| 26 | `test_wz_complete_no_batches_does_not_raise` |

### ExpiryDateOnPZTests (2 tests)

| # | Test |
|---|------|
| 27 | `test_expiry_date_propagates_to_stock_batch_on_complete` |
| 28 | `test_no_expiry_date_creates_batch_without_expiry` |

---

## Suggested Fix

Replace bare `select_for_update()` with `select_for_update(of=("self",))` wherever it is chained with `select_related()` on nullable FK relations. This restricts the PostgreSQL lock to only the `DeliveryDocument` row and avoids the outer-join restriction.

Example (views.py line 322):
```python
# Before
DeliveryDocument.objects.select_for_update()
    .select_related("company", "from_warehouse", "to_customer")
    .get(pk=doc.pk)

# After
DeliveryDocument.objects.select_for_update(of=("self",))
    .select_related("company", "from_warehouse", "to_customer")
    .get(pk=doc.pk)
```