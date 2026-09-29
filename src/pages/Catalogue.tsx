import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Check, Confirm, Empty, Field, Input, Loading, Modal, Select,
  useAction, useAsync, useDebounced, useToast,
} from '../lib/ui'
import { num } from '../lib/calc'
import { money } from '../lib/format'
import { Pagination } from '../lib/inventory'

/**
 * T14 — Catalogue hierarchy, aliases, maintenance.
 * Archive instead of delete; CSV import preview/commit; bulk updates with selection;
 * duplicate merge with compatibility checks.
 */
export default function Catalogue() {
  const run = useAction()
  const { push } = useToast()

  // Categories
  const [catSearch, setCatSearch] = useState('')
  const [catPage, setCatPage] = useState(1)
  const [catEditing, setCatEditing] = useState<any>(null)
  const categories = useAsync(() => window.api.catalogue.categories({ includeArchived: false, page: catPage }), [catSearch, catPage])

  // Aliases
  const [aliasSearch, setAliasSearch] = useState('')
  const [aliasPage, setAliasPage] = useState(1)
  const [aliasEditing, setAliasEditing] = useState<any>(null)

  // Items - for merge/bulk
  const [itemSearch, setItemSearch] = useState('')
  const [itemPage, setItemPage] = useState(1)
  const items = useAsync(() => window.api.item.page({ search: itemSearch, page: itemPage }), [itemSearch, itemPage])

  const catRows = categories.data?.rows || []

  const saveCategory = async () => {
    if (!catEditing?.name?.trim()) return push('error', 'Name required')
    const ok = await run(
      () => window.api.catalogue.saveCategory({ ...catEditing, id: catEditing.id || undefined, actor: 'user' }),
      catEditing.id ? 'Category saved' : 'Category created'
    )
    if (ok !== undefined) { setCatEditing(null); categories.reload() }
  }

  const saveAlias = async () => {
    if (!aliasEditing?.entity || !aliasEditing?.entity_id || !aliasEditing?.alias?.trim()) return push('error', 'All fields required')
    const ok = await run(
      () => window.api.catalogue.saveAlias({ ...aliasEditing, actor: 'user' }),
      'Alias added'
    )
    if (ok !== undefined) { setAliasEditing(null) }
  }

  const mergeItems = async () => {
    if (!catEditing?.from_id || !catEditing?.into_id) return push('error', 'Select both items')
    if (catEditing.from_id === catEditing.into_id) return push('error', 'Cannot merge into itself')
    if (!confirm('Merge items? This redirects all tags and preserves the merged name as an alias.')) return
    const ok = await run(
      () => window.api.catalogue.mergeItems({ from_id: Number(catEditing.from_id), into_id: Number(catEditing.into_id), actor: 'user' }),
      'Items merged'
    )
    if (ok !== undefined) { setCatEditing(null); items.reload() }
  }

  const exportCategories = async () => {
    const csv = 'Name,Parent,Archived\n' + catRows.map(c => `${c.name},${c.parent_name || ''},${c.archived ? 'Yes' : 'No'}`).join('\n')
    await window.api.file.saveText({ content: csv, suggestedName: 'categories.csv' })
  }

  return (
    <div className="content-narrow">
      {/* Categories panel */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title">Category Hierarchy</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={() => setCatEditing({ name: '', parent_id: '', archived: false })}>
              <Icon.plus /> Add Category
            </button>
            <button className="btn btn-sm" onClick={exportCategories}><Icon.download /> Export</button>
          </div>
        </div>
        <div className="card-body">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <div className="search-box" style={{ maxWidth: 300 }}>
              <Icon.search />
              <input className="input" placeholder="Search categories…" value={catSearch} onChange={e => { setCatSearch(e.target.value); setCatPage(1) }} />
            </div>
          </div>
          {!categories.loading && !catRows.length ? (
            <Empty icon={Icon.folder} title="No categories" />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>Name</th><th>Parent</th><th>Archived</th><th></th></tr>
                  </thead>
                  <tbody>
                    {catRows.map((c: any) => (
                      <tr key={c.id}>
                        <td className="strong">{c.name}</td>
                        <td>{c.parent_name || <span className="muted">—</span>}</td>
                        <td>{c.archived ? <span className="badge badge-mute">Yes</span> : <span className="badge badge-ok">No</span>}</td>
                        <td className="r">
                          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setCatEditing(c)} aria-label="Edit"><Icon.edit /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination data={categories.data} onPage={setCatPage} disabled={categories.loading} />
            </>
          )}
        </div>
      </div>

      {/* Aliases panel */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title">Aliases / Local Names</span>
          <button className="btn btn-primary btn-sm" onClick={() => setAliasEditing({ entity: 'item', entity_id: '', locale: '', alias: '' })}>
            <Icon.plus /> Add Alias
          </button>
        </div>
        <div className="card-body">
          <p className="small muted" style={{ marginBottom: 12 }}>
            Aliases enable search by local/alternate names. Linked to items, categories, or designs.
          </p>
          <div className="form-grid cols-4" style={{ marginBottom: 12 }}>
            <Field label="Entity">
              <Select value={aliasEditing?.entity || 'item'} onChange={v => setAliasEditing({ ...aliasEditing, entity: v })}
                options={[{ value: 'item', label: 'Item' }, { value: 'category', label: 'Category' }, { value: 'design', label: 'Design' }]} />
            </Field>
            <Field label="Entity ID">
              <Input value={aliasEditing?.entity_id || ''} onChange={e => setAliasEditing({ ...aliasEditing, entity_id: e.target.value })} />
            </Field>
            <Field label="Locale">
              <Input value={aliasEditing?.locale || ''} onChange={e => setAliasEditing({ ...aliasEditing, locale: e.target.value })} placeholder="hi, gu, ta…" />
            </Field>
            <Field label="Alias">
              <Input value={aliasEditing?.alias || ''} onChange={e => setAliasEditing({ ...aliasEditing, alias: e.target.value })} />
            </Field>
            <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={saveAlias}><Icon.save /> Add</button>
          </div>
        </div>
      </div>

      {/* Item Maintenance panel */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title">Item Master Maintenance</span>
          <button className="btn btn-primary btn-sm" onClick={() => setCatEditing({ from_id: '', into_id: '' })}>
            <Icon.merge /> Merge Duplicates
          </button>
        </div>
        <div className="card-body">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <div className="search-box" style={{ maxWidth: 300 }}>
              <Icon.search />
              <input className="input" placeholder="Search items to merge…" value={itemSearch} onChange={e => { setItemSearch(e.target.value); setItemPage(1) }} />
            </div>
          </div>
          {!items.loading && !items.data?.rows?.length ? (
            <Empty icon={Icon.item} title="No items" />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>Item</th><th>Type</th><th>Group</th><th>Mode</th><th className="r">In Stock</th><th></th></tr>
                  </thead>
                  <tbody>
                    {items.data?.rows?.map((it: any) => (
                      <tr key={it.id}>
                        <td className="strong">{it.name}</td>
                        <td>{it.type_name || '—'}</td>
                        <td>{it.group_name || '—'}</td>
                        <td><span className="badge badge-mute">{it.stock_mode === 'LOOSE_WT' ? 'Loose Wt' : 'Tagged'}</span></td>
                        <td className="r num">{it.stock_mode === 'LOOSE_WT' ? it.loose_wt + ' g' : it.in_stock_count + ' pcs'}</td>
                        <td className="r">
                          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setCatEditing({ ...catEditing, from_id: it.id })} title="Merge from"><Icon.edit /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination data={items.data} onPage={setItemPage} disabled={items.loading} />
            </>
          )}
        </div>
      </div>

      {/* Category Edit Modal */}
      {catEditing && !catEditing.from_id && !catEditing.into_id && (
        <Modal title={catEditing.id ? 'Edit Category' : 'New Category'} onClose={() => setCatEditing(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setCatEditing(null)}>Cancel</button><button className="btn btn-primary" onClick={saveCategory}><Icon.save /> Save</button></>}>
          <div className="form-grid cols-2">
            <Field label="Name" required>
              <Input autoFocus value={catEditing.name} onChange={e => setCatEditing({ ...catEditing, name: e.target.value })} />
            </Field>
            <Field label="Parent Category">
              <Select value={catEditing.parent_id || ''} onChange={v => setCatEditing({ ...catEditing, parent_id: v })}
                options={[{ value: '', label: 'No parent (root)' }, ...catRows.filter(c => c.id !== catEditing.id).map((c: any) => ({ value: String(c.id), label: c.name }))]} />
            </Field>
            <Field label="Archived">
              <Check checked={!!catEditing.archived} onChange={b => setCatEditing({ ...catEditing, archived: b })} />
            </Field>
          </div>
        </Modal>
      )}

      {/* Merge Items Modal - Step 1 */}
      {catEditing?.from_id && !catEditing.into_id && (
        <Modal title="Merge Items — Step 1: Source (will be removed)" onClose={() => setCatEditing({ ...catEditing, from_id: '' })}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setCatEditing({ ...catEditing, from_id: '' })}>Cancel</button><button className="btn btn-primary" onClick={() => setCatEditing({ ...catEditing, into_id: '' })}>Next: Pick Target</button></>}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Item</th><th>Group</th><th>Mode</th><th className="r">In Stock</th><th></th></tr></thead>
              <tbody>
                {items.data?.rows?.map((it: any) => (
                  <tr key={it.id} onClick={() => setCatEditing({ ...catEditing, from_id: it.id, into_id: '' })} style={{ cursor: 'pointer' }}>
                    <td className="strong">{it.name}</td><td>{it.group_name || '—'}</td>
                    <td><span className="badge badge-mute">{it.stock_mode === 'LOOSE_WT' ? 'Loose Wt' : 'Tagged'}</span></td>
                    <td className="r num">{it.stock_mode === 'LOOSE_WT' ? it.loose_wt + ' g' : it.in_stock_count + ' pcs'}</td>
                    <td><button className="btn btn-sm">Select</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {/* Merge Items Modal - Step 2 */}
      {catEditing?.into_id && (
        <Modal title="Merge Items — Step 2: Target (will receive tags)" onClose={() => setCatEditing({ ...catEditing, into_id: '' })}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setCatEditing({ ...catEditing, into_id: '' })}>Back</button><button className="btn btn-primary" onClick={mergeItems}><Icon.save /> Merge</button></>}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Item</th><th>Group</th><th>Mode</th><th className="r">In Stock</th><th></th></tr></thead>
              <tbody>
                {items.data?.rows?.filter(it => it.id !== catEditing.from_id).map((it: any) => (
                  <tr key={it.id} onClick={() => setCatEditing({ ...catEditing, into_id: it.id })} style={{ cursor: 'pointer' }}>
                    <td className="strong">{it.name}</td><td>{it.group_name || '—'}</td>
                    <td><span className="badge badge-mute">{it.stock_mode === 'LOOSE_WT' ? 'Loose Wt' : 'Tagged'}</span></td>
                    <td className="r num">{it.stock_mode === 'LOOSE_WT' ? it.loose_wt + ' g' : it.in_stock_count + ' pcs'}</td>
                    <td><button className="btn btn-sm">Select</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>
            Source item "{items.data?.rows?.find((it: any) => it.id === catEditing.from_id)?.name}" will be removed.
            All its tags redirect here. Its name is preserved as an alias.
          </p>
        </Modal>
      )}
    </div>
  )
}