import React, { useMemo, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Autocomplete, Check, Confirm, Empty, Field, Input, Modal, Segmented, Select,
  useAction, useAsync, useDebounced, useToast,
} from '../lib/ui'
import { wt } from '../lib/format'

/**
 * T14 — Catalogue hierarchy, aliases, CSV import and duplicate merge.
 * Archive instead of delete; imports are previewed first and a file imported
 * twice is a no-op; a merge re-points every bill, stock and order line.
 */

type Entity = 'item' | 'category' | 'design'
type Target = { id: number; name: string }
type Cat = { id?: number; name: string; parent_id: string; archived: boolean }

const csvCell = (v: any) => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '')

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

const fetchItems = async (q: string) => (await window.api.item.page({ search: q, page: 1, pageSize: 20 })).rows || []

export default function Catalogue() {
  const run = useAction()
  const { push } = useToast()

  /* ── Categories ── */
  const [catSearch, setCatSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const catQ = useDebounced(catSearch, 250)
  const categories = useAsync(() => window.api.catalogue.categories({ includeArchived: showArchived, search: catQ }), [catQ, showArchived])
  // The parent picker needs every live category, not just the ones matching the search.
  const allCats = useAsync(() => window.api.catalogue.categories({ includeArchived: false }), [])
  const unresolved = useAsync(() => window.api.catalogue.unresolved(), [])
  const [catEditing, setCatEditing] = useState<Cat | null>(null)
  const catRows = categories.data || []
  const reloadCats = () => { categories.reload(); allCats.reload(); unresolved.reload() }

  const saveCategory = async () => {
    if (!catEditing) return
    const ok = await run(() => window.api.catalogue.saveCategory({
      ...catEditing, parent_id: catEditing.parent_id ? Number(catEditing.parent_id) : null,
    }), catEditing.id ? 'Category saved' : 'Category added')
    if (ok !== undefined) { setCatEditing(null); reloadCats() }
  }
  const addUnresolved = async (name: string) => {
    const ok = await run(() => window.api.catalogue.saveCategory({ name }), `Added "${name}"`)
    if (ok !== undefined) reloadCats()
  }
  const exportCategories = () => window.api.file.saveText({
    suggestedName: 'categories.csv',
    content: ['name,parent,archived', ...catRows.map((c: any) => [c.name, c.parent_name || '', c.archived ? 'yes' : 'no'].map(csvCell).join(','))].join('\n'),
  })

  /* ── Aliases ── */
  const [aliasSearch, setAliasSearch] = useState('')
  const aliasQ = useDebounced(aliasSearch, 250)
  const aliases = useAsync(() => window.api.catalogue.aliasSearch({ q: aliasQ }), [aliasQ])
  const [alias, setAlias] = useState<{ entity: Entity; target: Target | null; text: string; alias: string; locale: string }>(
    { entity: 'item', target: null, text: '', alias: '', locale: '' })
  const designs = useAsync(() => window.api.design.list(), [])
  const [removeAlias, setRemoveAlias] = useState<any>(null)

  const fetchTargets = async (q: string): Promise<Target[]> => {
    if (alias.entity === 'item') return fetchItems(q)
    const needle = q.trim().toLowerCase()
    const list: Target[] = alias.entity === 'category' ? (allCats.data || []) : (designs.data || [])
    return list.filter(t => t.name.toLowerCase().includes(needle)).slice(0, 20)
  }
  const saveAlias = async () => {
    if (!alias.target) return
    const ok = await run(() => window.api.catalogue.saveAlias({
      entity: alias.entity, entity_id: alias.target!.id, alias: alias.alias, locale: alias.locale,
    }), 'Alias added')
    if (ok !== undefined) { setAlias({ ...alias, alias: '' }); aliases.reload() }
  }

  /* ── CSV import ── */
  const [imp, setImp] = useState<{ kind: 'category' | 'alias'; csv: string; file: string; preview: any } | null>(null)
  const previewCsv = async () => {
    if (!imp) return
    const preview = await run(() => window.api.catalogue.previewCsv({ kind: imp.kind, csv: imp.csv }))
    if (preview) setImp({ ...imp, preview })
  }
  const commitCsv = async () => {
    if (!imp) return
    // The key is the file itself: importing the same file again changes nothing.
    const batch_key = `${imp.kind}:${await sha256(imp.csv)}`
    const r = await run(() => window.api.catalogue.commitCsv({ kind: imp.kind, csv: imp.csv, batch_key }))
    if (r) {
      setImp(null); reloadCats(); aliases.reload()
      push(r.repeated ? 'info' : 'ok', r.repeated ? 'This file was already imported — nothing changed' : `Imported ${r.row_count} new ${imp.kind === 'category' ? 'categories' : 'aliases'}`)
    }
  }

  /* ── Merge ── */
  const [merge, setMerge] = useState<{ from: any; into: any; fromText: string; intoText: string } | null>(null)
  const [confirmMerge, setConfirmMerge] = useState(false)
  const mergeProblem = useMemo(() => {
    if (!merge?.from || !merge.into) return ''
    if (merge.from.id === merge.into.id) return 'Pick two different items.'
    if (merge.from.item_type_id !== merge.into.item_type_id) return 'These are different metal types — they cannot be merged.'
    if (merge.from.stock_mode !== merge.into.stock_mode) return 'One is tagged and one is sold by weight — they cannot be merged.'
    return ''
  }, [merge])
  const doMerge = async () => {
    setConfirmMerge(false)
    if (!merge?.from || !merge.into) return
    const r = await run(() => window.api.catalogue.mergeItems({ from_id: merge.from.id, into_id: merge.into.id }))
    if (r) {
      const lines = Object.values(r.moved || {}).reduce((a: number, n: any) => a + Number(n), 0)
      push('ok', `Merged — ${lines} record(s) now point to ${merge.into.name}`)
      setMerge(null); aliases.reload()
    }
  }
  const itemLabel = (it: any) => <><span className="strong">{it.name}</span> <span className="muted">{it.type_name || ''} · {it.stock_mode === 'LOOSE_WT' ? `${wt(it.loose_wt)} g loose` : `${it.in_stock_count} pcs`}</span></>

  return (
    <div className="content-narrow">
      {/* ── Categories ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title">Categories</span>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => setImp({ kind: 'category', csv: '', file: '', preview: null })}><Icon.upload /> Import CSV</button>
          <button className="btn btn-sm" onClick={exportCategories} disabled={!catRows.length}><Icon.download /> Export</button>
          <button className="btn btn-primary btn-sm" onClick={() => setCatEditing({ name: '', parent_id: '', archived: false })}><Icon.plus /> Add Category</button>
        </div>
        <div className="card-body">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <div className="search-box" style={{ maxWidth: 300 }}>
              <Icon.search />
              <input className="input" placeholder="Search categories…" value={catSearch} onChange={e => setCatSearch(e.target.value)} />
            </div>
            <Check label="Show archived" checked={showArchived} onChange={setShowArchived} />
          </div>
          {!!unresolved.data?.categories?.length && (
            <div className="small" style={{ marginBottom: 12 }}>
              <span className="muted">On tags but not in this list: </span>
              {unresolved.data.categories.slice(0, 12).map((u: any) => (
                <button key={u.value} className="btn btn-ghost btn-sm" title={`${u.n} tag(s) — add to categories`} onClick={() => addUnresolved(u.value)}>
                  <Icon.plus /> {u.value} <span className="muted">({u.n})</span>
                </button>
              ))}
            </div>
          )}
          {categories.error && <div className="danger small" role="alert">{categories.error}</div>}
          {!categories.loading && !catRows.length ? (
            <Empty icon={Icon.folder} title={catSearch ? 'No category matches' : 'No categories yet'} />
          ) : (
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table className="data">
                <thead><tr><th>Name</th><th>Parent</th><th className="r">Pieces in stock</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {catRows.map((c: any) => (
                    <tr key={c.id}>
                      <td className="strong">{c.name}</td>
                      <td>{c.parent_name || <span className="muted">—</span>}</td>
                      <td className="r num">{c.in_stock}</td>
                      <td>{c.archived ? <span className="badge badge-mute">Archived</span> : <span className="badge badge-ok">Active</span>}</td>
                      <td className="r">
                        <button className="btn btn-ghost btn-icon btn-sm" aria-label={`Edit ${c.name}`}
                          onClick={() => setCatEditing({ id: c.id, name: c.name, parent_id: c.parent_id ? String(c.parent_id) : '', archived: !!c.archived })}><Icon.edit /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Aliases ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title">Aliases / Local Names</span>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => setImp({ kind: 'alias', csv: '', file: '', preview: null })}><Icon.upload /> Import CSV</button>
        </div>
        <div className="card-body">
          <p className="small muted" style={{ marginBottom: 12 }}>
            Another name for an item, category or design — e.g. a local-language name — so it can be found by either.
          </p>
          <div className="form-grid cols-4" style={{ marginBottom: 14, alignItems: 'end' }}>
            <Field label="For">
              <Select value={alias.entity} onChange={v => setAlias({ ...alias, entity: v as Entity, target: null, text: '' })}
                options={[{ value: 'item', label: 'Item' }, { value: 'category', label: 'Category' }, { value: 'design', label: 'Design' }]} />
            </Field>
            <Field label="Name">
              {alias.target ? (
                <div className="row" style={{ gap: 6 }}>
                  <span className="strong">{alias.target.name}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAlias({ ...alias, target: null })}>Change</button>
                </div>
              ) : (
                <Autocomplete<Target> value={alias.text} onText={text => setAlias({ ...alias, text })} placeholder={`Find ${alias.entity}…`}
                  fetch={fetchTargets} onPick={target => setAlias({ ...alias, target, text: '' })} render={t => t.name} />
              )}
            </Field>
            <Field label="Also known as">
              <Input value={alias.alias} onChange={e => setAlias({ ...alias, alias: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter' && alias.target && alias.alias.trim()) saveAlias() }} />
            </Field>
            <div className="row" style={{ gap: 8 }}>
              <Input value={alias.locale} placeholder="Language (hi, gu…)" onChange={e => setAlias({ ...alias, locale: e.target.value })} />
              <button className="btn btn-primary" disabled={!alias.target || !alias.alias.trim()} onClick={saveAlias}><Icon.plus /> Add</button>
            </div>
          </div>
          <div className="search-box" style={{ maxWidth: 300, marginBottom: 10 }}>
            <Icon.search />
            <input className="input" placeholder="Search aliases or names…" value={aliasSearch} onChange={e => setAliasSearch(e.target.value)} />
          </div>
          {!aliases.loading && !(aliases.data || []).length ? (
            <div className="small muted">{aliasSearch ? 'No alias matches.' : 'No aliases yet.'}</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table className="data">
                <thead><tr><th>Alias</th><th>For</th><th>Name</th><th>Language</th><th></th></tr></thead>
                <tbody>
                  {(aliases.data || []).map((a: any) => (
                    <tr key={a.id}>
                      <td className="strong">{a.alias}</td>
                      <td className="muted">{a.entity}</td>
                      <td>{a.target_name || <span className="danger">missing #{a.entity_id}</span>}</td>
                      <td>{a.locale || <span className="muted">—</span>}</td>
                      <td className="r"><button className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${a.alias}`} onClick={() => setRemoveAlias(a)}><Icon.trash /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Merge duplicates ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title">Merge Duplicate Items</span>
          <span className="spacer" />
          {!merge && <button className="btn btn-sm" onClick={() => setMerge({ from: null, into: null, fromText: '', intoText: '' })}><Icon.merge /> Merge two items</button>}
        </div>
        <div className="card-body">
          {!merge ? (
            <p className="small muted">When the same item was created twice, merge the duplicate into the one to keep. Every tag, bill, purchase, order and loose-stock line moves across, and the duplicate’s name stays searchable as an alias.</p>
          ) : (
            <>
              <div className="form-grid cols-2">
                <Field label="Duplicate (will be removed)">
                  {merge.from ? <div className="row" style={{ gap: 8 }}>{itemLabel(merge.from)}<button type="button" className="btn btn-ghost btn-sm" onClick={() => setMerge({ ...merge, from: null })}>Change</button></div>
                    : <Autocomplete<any> value={merge.fromText} onText={fromText => setMerge({ ...merge, fromText })} placeholder="Find item…"
                        fetch={fetchItems} onPick={from => setMerge({ ...merge, from, fromText: '' })} render={itemLabel} />}
                </Field>
                <Field label="Keep (receives everything)">
                  {merge.into ? <div className="row" style={{ gap: 8 }}>{itemLabel(merge.into)}<button type="button" className="btn btn-ghost btn-sm" onClick={() => setMerge({ ...merge, into: null })}>Change</button></div>
                    : <Autocomplete<any> value={merge.intoText} onText={intoText => setMerge({ ...merge, intoText })} placeholder="Find item…"
                        fetch={fetchItems} onPick={into => setMerge({ ...merge, into, intoText: '' })} render={itemLabel} />}
                </Field>
              </div>
              {mergeProblem && <div className="danger small" style={{ marginTop: 8 }}>{mergeProblem}</div>}
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <span className="spacer" />
                <button className="btn" onClick={() => setMerge(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={!merge.from || !merge.into || !!mergeProblem} onClick={() => setConfirmMerge(true)}><Icon.merge /> Merge</button>
              </div>
            </>
          )}
        </div>
      </div>

      {catEditing && (
        <Modal title={catEditing.id ? 'Edit Category' : 'New Category'} onClose={() => setCatEditing(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setCatEditing(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={!catEditing.name.trim()} onClick={saveCategory}><Icon.save /> Save</button></>}>
          <div className="form-grid cols-2">
            <Field label="Name" required hint={catEditing.id ? 'Renaming also renames it on every tag' : undefined}>
              <Input autoFocus value={catEditing.name} onChange={e => setCatEditing({ ...catEditing, name: e.target.value })} />
            </Field>
            <Field label="Parent">
              <Select value={catEditing.parent_id} onChange={v => setCatEditing({ ...catEditing, parent_id: v })}
                options={[{ value: '', label: 'None (top level)' }, ...(allCats.data || []).filter((c: any) => c.id !== catEditing.id).map((c: any) => ({ value: String(c.id), label: c.name }))]} />
            </Field>
            <Field label="" className="span-2">
              <Check label="Archived — hidden from pickers, kept on old tags" checked={catEditing.archived} onChange={archived => setCatEditing({ ...catEditing, archived })} />
            </Field>
          </div>
        </Modal>
      )}

      {imp && (
        <Modal wide title={`Import ${imp.kind === 'category' ? 'Categories' : 'Aliases'} from CSV`} onClose={() => setImp(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setImp(null)}>Cancel</button>
            <button className="btn" disabled={!imp.csv.trim()} onClick={previewCsv}>Check file</button>
            <button className="btn btn-primary" disabled={!imp.preview || imp.preview.invalid > 0 || !imp.preview.valid} onClick={commitCsv}><Icon.upload /> Import {imp.preview?.valid || ''}</button></>}>
          <Segmented value={imp.kind} onChange={v => setImp({ ...imp, kind: v as any, preview: null })}
            options={[{ value: 'category', label: 'Categories' }, { value: 'alias', label: 'Aliases' }]} />
          <p className="small muted" style={{ margin: '10px 0' }}>
            {imp.kind === 'category'
              ? <>Columns: <span className="mono">name</span>, optional <span className="mono">parent</span>. Names already present are skipped.</>
              : <>Columns: <span className="mono">entity</span> (item / category / design), <span className="mono">entity_id</span>, <span className="mono">alias</span>, optional <span className="mono">locale</span>.</>}
          </p>
          <input type="file" accept=".csv,text/csv" onChange={async e => {
            const f = e.target.files?.[0]
            if (f) setImp({ ...imp, file: f.name, csv: await f.text(), preview: null })
          }} />
          <textarea className="textarea mono" rows={8} style={{ width: '100%', marginTop: 8 }} placeholder="…or paste the CSV here"
            value={imp.csv} onChange={e => setImp({ ...imp, csv: e.target.value, file: '', preview: null })} />
          {imp.preview && (
            <div style={{ marginTop: 10 }}>
              <div className="small"><span className="ok strong">{imp.preview.valid} ready</span>{imp.preview.invalid > 0 && <> · <span className="danger strong">{imp.preview.invalid} with errors — fix and check again</span></>}</div>
              {imp.preview.errors.length > 0 && (
                <ul className="small danger" style={{ margin: '6px 0 0 18px' }}>
                  {imp.preview.errors.slice(0, 20).map((er: any) => <li key={er.line}>Line {er.line}: {er.errors.join('; ')}</li>)}
                </ul>
              )}
            </div>
          )}
        </Modal>
      )}

      {removeAlias && (
        <Confirm title="Remove alias?" message={`"${removeAlias.alias}" will no longer find ${removeAlias.target_name || 'its target'}.`} confirmLabel="Remove"
          onCancel={() => setRemoveAlias(null)}
          onConfirm={async () => {
            const a = removeAlias; setRemoveAlias(null)
            const ok = await run(() => window.api.catalogue.removeAlias({ id: a.id }), 'Alias removed')
            if (ok !== undefined) aliases.reload()
          }} />
      )}

      {confirmMerge && merge?.from && merge.into && (
        <Confirm title="Merge these items?" confirmLabel="Merge"
          message={`"${merge.from.name}" will be removed. All its tags, bills, purchases and orders move to "${merge.into.name}". This cannot be undone.`}
          onCancel={() => setConfirmMerge(false)} onConfirm={doMerge} />
      )}
    </div>
  )
}
