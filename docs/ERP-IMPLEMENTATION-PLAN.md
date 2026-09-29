# Jewellery ERP implementation plan for agent execution

Prepared: 29 September 2026. Baseline: local Parivar Jewellery ERP 1.28.2 source.

This plan translates the supplied ERP assessment into executable work packages. It is a planning deliverable, not a claim that the features or tests below have been implemented. Source inspection was read-only; no application tests or performance benchmarks were run for this plan. Legal statements in the supplied assessment have not been independently revalidated; compliance implementation has an explicit verification gate below.

## 1. Intended outcome and scope

Make stock discovery complete and fast, make daily money and stock discrepancies reviewable, and add missing custody workflows without changing the meaning of existing sales, purchases, loose stock, schemes, or accounting records.

Deliver in four releases:

1. **R1 — Inventory discovery:** finish existing foundations, reach every matching item/document, export complete results, improve billing lookup.
2. **R2 — Daily control:** corrected dashboard, persistent parked bills, durable stock counts, closing and reconciliation.
3. **R3 — Custody and accountability:** approvals/history, repairs, reservations, memo stock and hallmarking.
4. **R4 — Convenience:** customer summary, catalogue maintenance, role starting screens and regional labels.

Natural-language inventory search, bank integrations, hardware integrations and a broad technology rewrite are not initial-release requirements. Photo cards and advanced valuation filters follow reliable table discovery.

## 2. Verified baseline: reuse before creating

Paths in this document are repository-relative. New paths are explicitly described as proposed. Recheck source before implementing because other agents may have changed it.

| Area | Observed implementation | Required direction |
|---|---|---|
| Runtime | React 18, TypeScript, Vite 6, Electron 33, better-sqlite3; `package.json` | Retain existing desktop/offline architecture |
| Backend | Large `electron/api.cjs`; groups exported and registered in `electron/main.cjs` | Add focused domain modules; avoid unrelated monolith refactors |
| IPC | `electron/preload.cjs`, `src/global.d.ts`; main returns `{ok,data,error}` and preload unwraps | Wire every new operation through all layers |
| Permissions | `electron/auth.cjs`: owner, manager, staff; main-process channel guard defaults unspecified channels to `daily` | Explicitly register every sensitive new channel; UI checks alone are insufficient |
| Database | `electron/schema.sql`; repeatable `migrate()` in `electron/db.cjs`; WAL and foreign keys | Support both clean installation and existing databases |
| Inventory queries | `electron/inventory.cjs` has `stock`, `items`, `facets`; exposed as `item.page`, `tagStock.page`, `tagStock.facets` | Extend and test, do not create a competing query engine |
| Discovery components | `src/lib/inventory.tsx` defines SearchSelect, Pagination, InventoryFilters, SavedViews | Existing primitives need integration and hardening; inspected page search found no adoption |
| Item screen | `src/pages/Items.tsx` calls `item.list` | Switch interactive list to page API |
| Stock screen | `src/pages/StockReport.tsx` passes search/status/groupBy without page | Integrate pagination, filters and full-result export |
| Saved views | Existing component stores filter JSON in device localStorage | Preserve device-local semantics initially; version and validate payloads |
| Billing search | `tagStock.search` limits results to 50; invoice also queries loose-item balances | Add ranked paging without losing loose-item billing |
| Documents | Several list queries contain `LIMIT 500` | Add page APIs and migrate consumers; retain compatibility during transition |
| Dashboard | `reports.dashboard` sums IN_STOCK tagged fine weight across metals | Split metals; label and reconcile tagged/loose scopes |
| Stock count | `StockCheck.tsx` reads all IN_STOCK tags and keeps scan progress in UI | Persist sessions and immutable expected sets |
| Existing stock meanings | `tag_stock.status` CHECK allows IN_STOCK/SOLD/ISSUED/MELTED; category/location/tray are text | Do not introduce incompatible enum values casually |
| Loose stock | `loose_stock` represents metal; `item_stock` represents LOOSE_WT item balances | Never combine these as if all item weight were precious metal |
| Navigation | `src/App.tsx` has custom `Route` and page dispatch, not an observed router library | Extend its route parameters/deep links |
| Test harness | Electron CJS scripts in `test/`; many dedicated npm scripts | Follow temporary-database test patterns such as `test/stockmaster.cjs` |
| Workspace | `git status` reports no Git repository; no project AGENTS.md found in filtered listing | Establish a versioned copy before multi-agent code changes; do not assume branches/worktrees exist |

The supplied assessment is useful product input, but its claims that these inventory foundations are entirely absent are superseded by the current source. Existing code is not proof of complete integration or passing validation.

## 3. Execution rules for every agent

1. Read this plan, the assigned package, and current relevant source. Record any mismatch before implementing.
2. Work only on the assigned package. Maintain existing public API behavior until all callers and tests are migrated.
3. Use synthetic data and temporary userData/database directories. Never run seeds, destructive tests or migrations against shop data.
4. Provide backend validation, permission enforcement and transactional writes before enabling a new mutation in the UI.
5. Use the existing calculation functions in `electron/calc.cjs` and `src/lib/calc.ts`. Do not invent a second pricing, tax or ledger implementation.
6. Use explicit DTOs for new interfaces. Do not extend the existing proliferation of `any` into new domain contracts.
7. Preserve historical document snapshots. Renaming a master or changing a rate must not recalculate saved invoices.
8. Record test commands, outcomes and limitations. A successful Vite build is not a TypeScript or accounting test.
9. Update this plan's task status and handoff record only for work actually completed.
10. Do not package, release, send customer communications or alter a production database merely because a development task is complete.

### Coordination and shared-file ownership

Use one integration owner for `electron/api.cjs`, `main.cjs`, `preload.cjs`, `db.cjs`, `schema.sql`, `src/global.d.ts`, `src/App.tsx` and `package.json`. Domain agents can propose exact integration patches, but concurrent edits to these files must be serialized. UI agents own assigned page/component files; backend agents own new domain modules; verification agents own fixtures/tests. These are suggested assignments for future execution, not agents started by this planning task.

Before parallel work, create a clean version-control baseline or separate task copies with an agreed integration procedure. Do not attempt automatic worktree commands in this currently unversioned directory.

Each handoff must contain:

```text
Task ID / status: not started | in progress | blocked | ready for review | done
Baseline revision or file snapshot:
Files changed / shared integration edits required:
Contracts and migrations added:
Behavior and invariants preserved:
Tests run and exact outcomes:
Known limitations / unresolved decisions:
Next task now unblocked:
```

## 4. Common contracts and invariants

### 4.1 List and export contract

Extend existing inventory names (`search`, `page`, `pageSize`, `sort`, etc.) rather than gratuitously renaming them. Proposed shared types belong in `src/types/` with corresponding backend validation.

```ts
type PageRequest<F> = F & { page?: number; pageSize?: number; sort?: string };
type PageResult<T, S> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totals?: S; // all matching rows, never merely the visible page
};
type Selection<F> =
  | { mode: 'ids'; ids: number[] }
  | { mode: 'allMatching'; filters: F; excludedIds: number[] };
```

- Retain existing inventory `groups` response where needed. For grouped queries, `total` is number of groups; `totals.count` is matching pieces. Label both explicitly.
- Default 50 rows; enforce integer bounds of 10–200 as current inventory code does. Validate nonfinite numbers, ranges and allowed sort fields.
- Stable sorting always includes a unique ID tie-breaker. Clamp pages after filters/deletions, and reset page on filter changes.
- Filters, count, aggregate and export must share one validated predicate builder. All SQL values are bound parameters; sort SQL comes from a whitelist.
- Every interactive list request must explicitly page; legacy inventory calls without `page` can return all rows and must not accidentally remain in UI paths.
- Exports use the same filters and authorization, with totals and snapshot timestamp. Produce bounded chunks or a backend file operation so a large export does not freeze Electron. Define snapshot semantics so edits during export cannot create duplicate/missing rows.
- Bulk mutations revalidate the target set in a transaction. Preview count and conflicts before execution; do not silently apply a saved selection to a changed dataset.
- Cancel or ignore stale search responses. Show loading, no results, error and retry states distinctly.

### 4.2 Inventory identity and custody

Category, design, item master and individual tag are different identities. Keep `item_group` purity semantics; do not repurpose it into a category tree.

Use additive custody/hold records rather than overloading `tag_stock.status`. Proposed records distinguish ownership (shop/customer/supplier), physical custodian (shop/customer/karigar/assaying centre), and availability. Derive saleability in one backend helper and use it in lookup AND final sale save, transfers, stock adjustments, melting and returns.

Initial rule: a shop tag is available only when its existing stock status permits sale, it is physically at a permitted selling location, and it has no active conflicting hold. Customer repairs and supplier memo goods are not owned saleable stock. Supplier goods require an explicit acquisition workflow before normal sale.

Every custody change records actor, timestamp, reason, source document and old/new state. Preserve legacy behavior for existing rows with no holds. Existing ISSUED rows require classification during migration review; do not assume they are in the shop.

### 4.3 Money and accounting

- Persist monetary precision using the established rounding model. New settlement matching can use integer paise internally; conversions must be explicit and tested.
- One receipt must be counted once even if represented by a sale payment, voucher and ledger entry. Define authoritative event sources before building closing totals.
- Customer deposits, scheme receipts, sales revenue and old-gold consideration have different meanings. Report collections separately from billed sales.
- Reconciliation links explain existing movements; they must not post a second receipt. An approved correction posts through existing accounting services with a unique source reference.
- Approval and mutation commit atomically; a rejected or stale approval cannot affect stock or books.
- Add idempotency keys and expected-version checks to new finalization/posting endpoints. A retry returns the existing result or a precise conflict, not another posting.

### 4.4 Time, authorization and history

Persist event timestamps consistently and retain a separate business date. Select the shop's business timezone and cut-off policy in T00; do not derive Indian trading days from the development computer's timezone. Restrict cost/margin fields in backend projections, exports, global search and detail views, not only hidden columns.

Operational role presets (salesperson/cashier/stock staff) initially configure home screens within owner/manager/staff. Any expanded permission matrix is a deliberate migration, not a silent role rename.

### 4.5 Migration and backup discipline

For every schema change: update fresh schema and repeatable migration; apply on a prior-version fixture twice; test failed migration rollback; run `foreign_key_check` and `integrity_check`; compare pre/post money and stock totals. Add indexes after required columns exist.

Introduce a migration ledger for new multi-step migrations while preserving current idempotent migrations. Back up safely with WAL-aware existing mechanisms. A prior binary may not understand new schemas: rollback means a verified compatible binary/database pair, not opening a migrated database with an old app. Restore drills must preserve/reconcile post-backup transactions.

Repair photos require a defined managed storage and backup format. Existing database-only backup must not silently omit attachments. Keep photo intake disabled until attachment backup and restore pass.

## 5. Task map and dependencies

All tasks start **not started**. Existing foundations do not mark tasks complete.

| ID | Work package | Depends on | Suggested owner | Release |
|---|---|---|---|---|
| T00 | Baseline, workflow decisions, fixture and measurement contract | — | Integration/product | All |
| T01 | Shared list contracts and inventory query hardening | T00 | Backend | R1 |
| T02 | Inventory screen and selectors | T01 | UI | R1 |
| T03 | Billing/global search and document pagination | T01; T02 for shared controls | Backend + UI | R1 |
| T04 | Exports, bulk selection and performance gate | T02, T03 | Integration/QA | R1 |
| T05 | Audit, approvals and availability foundation | T00 | Backend/security | R2 foundation, R3 UI |
| T06 | Persistent parked bills | T05 | Billing | R2 |
| T07 | Persistent stock counts | T01, T05 | Inventory | R2 |
| T08 | Daily closing and payment reconciliation | T05 | Accounting | R2 |
| T09 | Operational dashboard | T01; T06–T08 for their alerts | Dashboard | R2 |
| T10 | Repairs and attachment custody | T05 | Operations | R3 |
| T11 | Reservations and approval/memo stock | T05; T06 for draft conversion | Inventory | R3 |
| T12 | Hallmarking and compliance configuration | T05 | Operations | R3 |
| T13 | Customer summary | T03, T08, T10, T11 | CRM | R4 |
| T14 | Catalogue hierarchy, aliases and maintenance | T01, T05 | Catalogue | R4 |
| T15 | Role start screens and regional labels | T09, T13 | UX | R4 |
| T16 | Integration, migration, regression and release rehearsal | Each release's tasks | Integration/QA | Every release |

R1 and the T05 foundation may proceed independently after T00. After T05, T06/T07/T08 can proceed independently in separate modules. Start T09's metal correction early; add alerts only when their source workflows exist. Advanced category-tree UI depends on T14 even if the simpler inventory filters ship in R1. No task waits on hypothetical bank or hardware integrations.

## 6. Detailed work packages

### T00 — Establish baseline and implementation decisions

**Files:** `package.json`, existing tests, `docs/`; source files listed above.

1. Record source snapshot and run build/typecheck/parse plus representative existing stock, sale, payment and backup tests using isolated test data. Record pre-existing failures separately.
2. Observe or obtain shop examples for stock lookup, billing/old gold, repairs and closing. This is validation input, not a prerequisite for read-only discovery work.
3. Create a decision register: shop timezone, branch/cash-drawer attribution, day cut-off, who may approve adjustments, discount/rate thresholds, memo acquisition rules, repair weight tolerance, attachment retention, count movement policy.
4. Defaults until confirmed: local offline operation; owner approves financially material changes; explicit reservation only (parking does not reserve); stock count snapshot plus movement exceptions; manual digital-payment matching; no automated tax-rule changes.
5. Seed reproducible fixtures: 50,000 tags, 5,000 items, over 500 records for each migrated document list, duplicated names, sold/issued tags, mixed metals, zero cost, loose pools, LOOSE_WT items, multiple branches and Unicode labels.

**Acceptance:** baseline results and decision register saved; fixtures never touch live data; branch attribution limitations documented before claiming branch-specific financial closing.

### T01 — Harden shared inventory and query contracts

**Files:** `electron/inventory.cjs`, `electron/api.cjs`, bridge/types; proposed `src/types/inventory.ts`, `test/inventory-discovery.cjs`.

1. Type and validate existing inventory request/response shapes. Test totals for grouped and ungrouped results.
2. Extend missing structured filters incrementally: supplier, purchase batch, age/as-of date and availability first; collection/occasion and stone details only after data fields exist.
3. Provide exact-tag and exact-HUID lookup distinct from broad substring matching; normalize surrounding whitespace/case without destructive edits to stored identifiers.
4. Audit metal derivation across direct item type and group type links. Do not guess unknown types as Gold; surface data-quality exceptions.
5. Add parameterized, selective facet queries; handle inconsistent historical category/location values. Index only after inspecting `EXPLAIN QUERY PLAN` on fixture queries.
6. Implement estimated-price filter only after defining rate ID/time, charge rules and GST inclusion. Use shared calculator behavior, invalidate on rate changes, label estimates. If SQL cannot match calculator semantics, use a versioned projection rather than filtering only the current page.

**Acceptance:** every fixture record reachable; exact matches rank first; invalid ranges rejected; aggregates independently reconcile; pagination order deterministic; no cost fields leak to restricted callers. Price filtering may ship later than R1 but must never use an inaccurate approximation without a visible definition.

### T02 — Integrate inventory screens and searchable selectors

**Files:** `src/pages/Items.tsx`, `TagStock.tsx`, `StockReport.tsx`, `src/lib/inventory.tsx`, `src/lib/ui.tsx`, `src/lib/listNavigation.ts`, `src/styles.css`.

1. Adopt existing page APIs and Pagination. Preserve editing, label printing, grouping, loose-stock sections and permissions.
2. Add scan/search, visible result count, common filters, removable chips, clear-all and existing SavedViews. Save filter/sort/page state and restore scroll after detail navigation.
3. Use a compact table and selected-piece detail panel (photo, weights, rate estimate, location, permitted history). Make photo cards optional after table flow passes.
4. Keep Gold → purity group → category → weight → available → tray filter flow usable without a category migration.
5. Retain small native selects. Extend SearchSelect with an async page source for large masters; current bounded rendering still loads and filters the entire options array.
6. Test Arrow keys, Enter, Escape, Tab, focus restoration and the application's optional Tab-list-navigation mode. Reset active selection when options change.
7. Validate saved-view payload version; gracefully discard unsupported fields and explain stale IDs. Store filters only, never financial rows.

**Acceptance:** a staff member can find and reopen the 6–10 g gold jhumka view, reach last page, open a piece and return without lost context. No action applies to an unintended hidden selection. Layout works at 1366×768 and 125% Windows scaling. Default paged UI renders bounded rows; virtualization is added only for measured large continuous lists.

### T03 — Complete billing search, global search and document lists

**Files:** `SalesInvoice.tsx`, `SalesList.tsx`, `Purchase.tsx`, `OldGold.tsx`, `Orders.tsx`, `Receipts.tsx`, `Returns.tsx`, `Refining.tsx`, related list consumers, `src/App.tsx`, API/bridge.

1. Enumerate every `LIMIT 500` list and its caller. Add `.page` endpoints for sales, old gold, purchases, refinery, orders, vouchers, returns and stock settlements where applicable.
2. Keep `.list` contracts while transitioning exports/legacy callers. Add stable date/ID ordering, date filters, matching counts and totals.
3. Replace billing's silent first-50 behavior with exact lookup plus paged results or an explicit “all matching stock” picker. Preserve loose-item and untagged workflows.
4. Extend Ctrl+K with typed results: page, customer, supplier, tag, HUID, invoice and order. Group by entity type; cap preview groups but provide a path to every match.
5. Extend custom route parameters for precise record/detail/filter destinations. Apply final saleability checks again on save.

**Acceptance:** locate a record beyond 500; select a tag beyond first 50 broad matches; exact scan cannot silently select a similarly named tag; keyboard flow remains functional; sold or held tags cannot bypass final validation; query errors do not look like empty stock.

### T04 — Complete exports, selection and performance

**Files:** `src/lib/export.ts`, relevant list pages, backend export helper (proposed), performance fixture/test scripts.

1. Export all matches, not loaded rows, using shared filters. Preserve CSV quoting, Unicode and protect spreadsheet-bound text fields from formula injection.
2. Show “Select this page” versus “Select all N matching records”; maintain explicit exclusions. Clear/reconfirm selection when filters change.
3. Run aggregation and export against a defined snapshot; avoid holding a main-process blocking transaction while waiting for a file dialog. Support progress and cancellation without leaving a file presented as complete.
4. Measure cold/warm queries, IPC and rendered response separately on a recorded Windows reference machine.

**Proposed targets, not measured claims:** at fixture size, warm exact lookup p95 ≤150 ms; paginated structured lookup p95 ≤500 ms; first interactive page ≤1 s excluding startup; immediate typing feedback and no recurring >200 ms UI stalls. Record at least 30 representative measured runs and dataset/hardware details. Full exports need completeness and responsive progress; establish their time budget from measurements.

**Acceptance:** exported count and totals equal independent SQL for identical filters; all-match selection excludes deselected IDs correctly; later pages and broad queries meet agreed budgets or ship with an explicitly documented tuning blocker.

### T05 — Audit, approval and stock availability foundation

**Proposed modules:** `electron/audit.cjs`, `electron/approvals.cjs`, `electron/availability.cjs`; later `src/pages/Approvals.tsx`. Integrate existing write handlers and permission map.

**Proposed tables:** `audit_event` (actor, operation, entity, entity_id, business_date, timestamp, reason, before/after JSON, correlation ID); `approval_request` (action, target, proposed payload/hash, target version, status, requester/reviewer, reason/timestamps); `stock_hold` (tag, kind, source, state, expiry/version); custody event records as required by T10–T12.

1. Document owner/manager/staff action matrix for read, request, approve, adjust, reopen and cost visibility. Sensitive new IPC channels must have explicit permissions.
2. Add append-only application audit recording within mutation transactions. Exclude passwords/tokens and unnecessary personal information. Do not claim local SQLite history is cryptographically tamper-proof.
3. Implement requested → approved/rejected/cancelled; approval execution checks current entity version and exact proposed payload. Reject self-approval where configured; changes invalidate approval.
4. Route discounts, rate overrides, backdated edits, cancellations and stock corrections through policy thresholds. Preserve normal low-risk work when policy allows it.
5. Centralize effective saleability. Use a unique active-hold constraint or equivalent transactional exclusion; ensure overlapping reservations/memo/hallmark holds cannot succeed.
6. Inventory all mutation paths, including mobile API paths, returns, stock transfers and destructive operations. Direct backend callers must not bypass required policy.

**Acceptance:** unauthorized direct IPC fails; duplicate execution creates one result; two conflicting holds cannot commit; stale approval fails; a failed mutation leaves neither a posted change nor a misleading success audit. Audit UI can follow a piece/document's changes.

### T06 — Persistent parked bills

**Files:** `SalesInvoice.tsx`; proposed `electron/parkedBills.cjs` and `test/parked-bills.cjs`.

**Table:** `parked_bill` with owner/user, optional branch, schema version, draft JSON, revision, status, created/updated timestamps, conversion idempotency key and resulting sale ID. Snapshot customer/lines, exchange inputs, split-payment inputs, scheme links and rate context; never store authentication secrets.

1. Add explicit Park/Resume/Discard and a persistent draft list. Autosave after a debounce if enabled; indicate saved/saving/failed and do not claim crash durability before commit.
2. Parking allocates no legal bill number, posts no ledger movement and reserves no stock by default.
3. Resume revalidates party, tag state, scheme/advance balances and rates. Highlight changes; do not silently overwrite old prices.
4. Finalize through normal sale save; sale creation and draft converted marker share one transaction/idempotency contract.

**Acceptance:** restart retains all committed draft fields; stale versions conflict; already-sold tag blocks checkout; double-click/retry produces one invoice; discarding a draft changes no money or stock.

### T07 — Saved stock-count sessions

**Files:** `StockCheck.tsx`; proposed `electron/stockCounts.cjs` and dedicated tests.

**Tables:** `stock_count_session` (scope JSON, business date, status, creator/reviewer/version); `stock_count_expected` (session/tag plus snapshot weights/location/state); `stock_count_scan` (raw scan, resolved tag, timestamp, actor, classification); `stock_count_resolution` (exception, evidence, proposed correction, approval/posting reference).

1. Create a durable session with an immutable expected set for a selected tray/counter/branch. Initial scope is individually tagged stock; loose quantities require separate weighed count entries later.
2. Save each scan promptly; classify matched, duplicate, unknown, wrong location, already sold and outside scope. Duplicate scans do not increment counted pieces.
3. Support open → paused → submitted → approved/closed, plus cancelled. Submitted sessions are read-only except controlled reopen.
4. Compare movements after snapshot against the count. Surface sold/transferred/received exceptions; never mark a post-snapshot sale missing automatically.
5. Require investigation and approved explicit adjustment. A missing scan alone never deletes stock or creates an accounting write-off.
6. Export expected/count/discrepancies and link reviewer decisions. New repair/memo/hallmark custody classifications feed later physical-count views without conflating ownership.

**Acceptance:** pause/restart/resume retains counts; repeated scans are safe; movements during count produce explainable exceptions; approved adjustments post once and preserve history; no unexplained stock loss from session completion.

### T08 — Daily closing and payment reconciliation

**Files:** `DayBook.tsx`, `Receipts.tsx`, accounting APIs; proposed `electron/closing.cjs`, `src/pages/DailyClosing.tsx`, reconciliation tests.

**Tables:** `closing_session` (business date, branch/drawer scope, state, revision, source cutoff/fingerprint, expected/count/variance and approvals); `closing_count` (denomination/quantity or explicit count); `payment_settlement` (provider/reference/date/gross/fees/net); `settlement_match` (source event identity, allocated amount, settlement reference); unique deduplication keys.

1. Map all authoritative movements: cash sales, split payments, receipts, refunds, purchase/old-gold payments, expenses, scheme/order/repair advances, bank transfers and opening balances. Trace each to existing ledger postings and prevent duplication.
2. Define expected cash as approved opening cash plus cash inflows minus cash outflows within business-date/scope rules. Purchases on credit do not reduce cash; noncash old-gold exchange is not a cash receipt.
3. If documents lack reliable branch/drawer attribution, ship company-wide closing first and block misleading scoped totals until attribution is implemented.
4. Support draft → submitted → approved/locked; reopening creates a revision with reason. Decide whether late/backdated mutations are blocked or invalidate/reopen a close, then enforce across every financial writer.
5. Match UPI/card events manually first; allow partial, many-to-one and delayed settlements. Distinguish transaction date from settlement date, gross, fees, refunds/chargebacks and net bank amount.
6. Matching does not repost money. Variance requires explanation; any correction is a separately approved accounting document. Preserve previous sign-off snapshots.

**Acceptance:** mixed-payment fixture reconciles independently with daybook/cash ledger; matching total cannot exceed allocatable amount; duplicate provider references cannot double count; late events visibly invalidate or block a close; sign-off cannot silently absorb a changed source set.

### T09 — Owner's daily dashboard

**Files:** `Dashboard.tsx`, `reports.dashboard`, `src/App.tsx`; proposed dashboard DTO/tests.

1. Correct tagged-stock totals by metal and include net/fine weights with explicit scope. Show loose precious-metal pools separately; LOOSE_WT items remain separate inventory measures.
2. Preserve existing cards during DTO transition, then arrange rates/update actor, attention queue, today's money, stock by metal, quick actions and trends.
3. Today's money separates invoiced sales, actual collections, refunds, cash and unsettled digital receipts. Reuse T08's event classification.
4. Add overdue orders immediately; add parked bills, count discrepancies, approvals, repairs and hallmarking alerts only as their modules ship.
5. Each alert carries a real route plus filters. Alert count and destination list use the same predicate/business date.
6. Expose rate change actor only from real audit events; show unknown for legacy data rather than inventing attribution.

**Acceptance:** mixed Gold/Silver/Platinum fixture has separate correct balances; no mixed-metal fine-weight headline; clicks open the counted records; unavailable data is shown as unavailable, never zero.

### T10 — Customer repair register

**Proposed files:** `electron/repairs.cjs`, `src/pages/Repairs.tsx`, repair print template and tests; use existing party and karagir features where their semantics match.

**Tables:** repair header, repair articles, repair events, attachment metadata and explicit issue/return records. Capture customer, description/photos, intake gross/net/stone details, damage, requested work, estimate, promised date, karigar, customer acknowledgement and eventual collection acknowledgement.

1. States: received → assessed → assigned → in progress → ready → delivered, with cancellation returning the physical article. Support partial article processing/delivery.
2. Create repair custody identity separate from saleable tag stock. Link karigar work without treating customer metal as shop-owned stock or posting an unrelated metal balance.
3. Record issue/return weights, stones and discrepancy reasons against configurable tolerances. Preserve before/after photos and estimate revisions.
4. Link deposits and final collection to existing accounting documents; collect repair charges through an approved transaction/tax configuration. Do not create a second independent cash ledger.
5. Store files under managed IDs, validate type/size, avoid arbitrary filesystem path access, and implement attachment backup/restore before enabling photo capture.

**Acceptance:** intake and collection printable; overdue job visible; partial return traceable; customer article cannot appear in billable shop stock; deposits counted once; restored backup includes readable photos.

### T11 — Reservations and approval/memo stock

**Proposed files:** `electron/reservations.cjs`, `electron/memos.cjs`, corresponding pages and tests. Reuse T05 holds and T06 conversion behavior.

**Tables:** reservation header/items with customer, expiry, linked advance and status; memo header/items with direction, counterparty, custodian, due date, issued/returned/acquired quantities and source tag or separate supplier article identity.

1. Reservations: active → fulfilled/released/expired. Expiry uses authoritative backend time; startup and sale validation handle expired holds even when the app was closed.
2. An advance is a linked accounting transaction; release/refund follows an explicit workflow and does not disappear when a hold expires.
3. Outbound approval: shop-owned piece moves to external custody, remains owned, becomes unavailable for normal sale. Support partial returns and approved sale conversion.
4. Inbound supplier memo: separate supplier-owned custody items; excluded from owned stock value. Explicit purchase/acquisition converts ownership once before ordinary sale/tagging.
5. Prevent double allocation across reservations, memo, hallmarking and sale. Handle cancellation and partial conversions with immutable event references.

**Acceptance:** expiry restores availability correctly; two reservations cannot lock the same piece; memo issue is not sale revenue; inbound memo is excluded from owned valuation; return/acquisition/sale transitions reconcile ownership, custody, counts and books.

### T12 — Hallmarking and verified compliance configuration

**Proposed files:** `electron/hallmarking.cjs`, `src/pages/Hallmarking.tsx`; existing `src/print/invoice.ts`, calculation/configuration and tests.

**Tables:** hallmark batch, batch items, item events, centre details, issue/return weights, charges, HUID and exception resolutions. Use stock holds while pieces are away.

1. Support prepared → dispatched → partially returned → closed/cancelled; track each item independently through returned/failed/rework outcomes.
2. Validate identifier format against current verified requirements and flag duplicates/inconsistencies for investigation without inventing unsupported legal prohibitions.
3. Record returned weights and HUID with traceability to purchase, tag, sale and return. Weight changes require review rather than overwriting historical invoice snapshots.
4. Before changing invoice/tax behavior, verify current official BIS/GST guidance and document source, retrieval date, applicability and effective dates. The supplied historical FAQ is not executable tax specification.
5. Distinguish internal policy warnings from legal requirements; do not label every missing printed HUID a violation based solely on the pasted assessment.
6. Make transaction-type/effective-date configuration explicit; verify separate sale, repair/service and job-work cases with the responsible domain reviewer. Preserve past invoices under original rule snapshots.

**Acceptance:** partial return works; away pieces cannot be sold; fees are posted only once via existing mechanisms; compliance test expectations cite the verified rule/configuration; missing information yields a precise actionable warning.

### T13 — Customer summary

**Files:** `Parties.tsx`, `party` API; proposed `CustomerSummary.tsx` and summary query module.

Provide one customer workspace showing purchases/returns, money dues, metal balances by metal, advances, schemes, orders, repairs and reservations. Paginate the combined activity timeline with typed source links. Reuse authoritative balances rather than summing displayed records. Explain money versus metal balances and refundable versus allocated advances. Apply existing role/branch visibility to every section.

**Acceptance:** summary reconciles to ledger/outstanding/scheme screens; one event linked through several modules is not presented as multiple payments; balances remain correct when timeline is paginated; every row opens its source.

### T14 — Catalogue hierarchy, aliases and controlled maintenance

**Files:** `Items.tsx`, inventory queries; proposed catalogue module/import preview UI/tests.

1. Add a category table with parent ID, stable ID, label and archive flag; prevent cycles. Preserve current free-text tag category until reviewed mappings exist. Add nullable normalized links and an unresolved-values report.
2. Keep design identity and item attributes separate; add aliases/local-language names with locale and entity links. Search exact IDs first, then alias/name matches with deterministic ranking.
3. Add archive rather than delete for referenced masters. Archived records remain readable in historical documents and existing stock.
4. CSV import first: parse, map columns, validate units/types/duplicates and preview row-level errors. Commit with batch identity, idempotency and audit; support defined all-or-nothing semantics.
5. Bulk updates use T04 selection semantics and show old/new values. Never change historical invoice lines, current stock weight or costs through a generic catalogue bulk edit.
6. Merge duplicates only after reference impact preview and compatibility checks (metal, purity, stock mode). Redirect live master references transactionally, retain aliases and preserve document snapshots. Block incompatible merges.

**Acceptance:** no orphan/cyclic category data; Unicode aliases work; failed import leaves no partial batch; repeated import is safe; archived masters remain readable; merging cannot transform a loose-weight item into tagged precious-metal stock.

### T15 — Role starting screens and regional labels

**Files:** `App.tsx`, `Settings.tsx`, relevant UI labels; proposed navigation preference/translation helpers.

Add owner, cashier, sales and stock-work presets as home/navigation preferences. Backend permissions remain authoritative. Add favourites/recent records using IDs and permission checks, remove stale destinations gracefully, and allow reverting to the default navigation. Centralize customer-facing labels before translating; begin with one shop-selected language and tested Unicode fonts. Keep IDs, quantities and stored business values language-independent. Test keyboard shortcuts and printable labels after translation.

**Acceptance:** each preset reaches its daily actions quickly; hiding navigation never grants access; shared-device recent history follows the agreed user scope; long translations do not truncate critical controls.

### T16 — Integration and release rehearsal

For each release, integrate shared files serially; test new install, prior-version upgrade and backup restore; run domain tests plus complete regression once the release candidate is stable. Conduct a shop-day scenario: receive/tag stock → find/reserve → park/resume → invoice with old gold/split payment → return/refund → count → close/reconcile. R3 adds repair/memo/hallmark issue and partial return. Confirm inventory and ledger reconciliation after each stage.

Release gates: no unresolved financial/stock integrity defect; no unauthorized mutation or cost leak; no silent result truncation in migrated screens; migration/restore success; reconciled reports; measured performance; keyboard/layout verification; documented owner workflow review. Package only after gates pass and the release is separately authorized.

## 7. Test commands and verification matrix

Existing commands, to be run by implementation agents after confirming temporary-data isolation:

```powershell
npm run build
npx tsc --noEmit
npm run test:parse
npm run test:auth
npm run test:stockmaster
npm run test:stockedit
npm run test:loosepool
npm run test:looseflow
npm run test:splitpay
npm run test:returns
npm run test:books
npm run test:daybook
npm run test:backup
npm run test:flows
npm run test:all
```

Use focused commands during development; use `test:all` at an integrated release gate rather than repeatedly after cosmetic changes. Some UI tests require a built renderer. New proposed test filenames are not existing npm scripts; register them deliberately or invoke them using the established Electron harness.

| Concern | Required evidence |
|---|---|
| Pagination | First/middle/last page; >500 matches; same-name/date ties; empty filters; deletion on last page |
| Search | Exact tag/HUID, Unicode aliases, escaped `%`/`_`, stale response ordering, no swallowed errors |
| Totals/export | Independent all-match SQL versus API versus exported rows; grouped count semantics |
| Authorization | Direct IPC and alternative/mobile paths; denied cost projections and exports |
| Atomicity | Inject failure mid-write; no partial hold, posting or approval; retry creates one result |
| Migration | Clean install, old fixture, repeated migration, interrupted migration recovery, integrity checks |
| Custody | Owned/present/available differ correctly; partial return; conflicting holds; sold piece count exception |
| Financial closing | Split/partial/late settlement, fee, refund, old gold, credit sale, backdated edit, reopening |
| Persistence | Restart after acknowledged draft save/scan/sign-off; unsaved state is clearly indicated |
| UI | Keyboard/scanner, focus, scaled Windows layout, loading/error/empty, return navigation |
| Backup | Restore new tables and photos; old backups upgrade; no stale WAL or missing attachment claims |
| Performance | Fixture seed reproducible; reference hardware, sample size, warm/cold p95 and query plans recorded |

## 8. Business decisions that gate specific mutations

Agents can begin T01–T04 using current source. Obtain answers only when the dependent feature needs them; do not stop unrelated implementation.

| Decision | Safe planning default | Must resolve before |
|---|---|---|
| Business timezone/cut-off | Explicit configured shop day | T08 approval and T09 daily money |
| Branch/drawer source attribution | Company-wide money totals | Branch-specific closing |
| Approval thresholds and reviewers | Owner review for material exceptions | T05 policy activation |
| Count movement handling | Snapshot plus explicit movement exceptions | T07 adjustments |
| Parked bill reservation | No implicit hold | T06/T11 integration |
| Supplier memo direct selling | Acquisition before ordinary sale | T11 conversion |
| Repair tolerances, photos and retention | Record actual observations; managed backed-up storage | T10 delivery/photo enablement |
| Tax/invoice applicability | Preserve current behavior pending verified rules | T12 rule changes |
| Shared vs personal saved views | Existing device-local views | Cross-user/cloud sharing |
| Target language/hardware | Existing language and scanner keyboard input | T15 translation or hardware work |

## 9. Suggested agent assignment prompt

```text
Implement task [Txx] from docs/ERP-IMPLEMENTATION-PLAN.md.
Read the baseline, invariants, dependencies and the task's acceptance criteria first.
Confirm dependency artifacts are ready and inspect current source for drift.
Own only [files/modules]. Coordinate shared-file edits with the integration owner.
Preserve existing calculations, APIs and historical document snapshots.
Use temporary test databases. Do not touch live shop data or publish a release.
Deliver the feature end-to-end with relevant migration, bridge, permission,
UI, test and backup integration. Record actual verification evidence and the
handoff fields from section 3. Escalate unresolved business decisions only
when they block dependent behavior; continue independent authorized work.
```

Start execution with T00, then T01. Complete the R1 end-to-end stock discovery slice before adding advanced UI, and build T05 before any new workflow can affect stock custody or accounting.
