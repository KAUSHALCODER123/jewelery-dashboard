import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Check, Confirm, Empty, Field, Input, Loading, Modal, Select,
  useAction, useAsync, useDebounced,
} from '../lib/ui'

const BLANK = {
  id: null as number | null,
  name: '',
  item_type_id: '',
  item_group_id: '',
  design_id: '',
  weight_mode: 'WEIGHT',
  uom: 'GRAM',
  hsn: '7113',
  reorder_level: 0,
  image: '',
}

export default function Items() {
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 250)
  const [editing, setEditing] = useState<any>(null)
  const [confirming, setConfirming] = useState<any>(null)
  const [masterOpen, setMasterOpen] = useState<null | 'item_type' | 'item_group' | 'design'>(null)

  const run = useAction()
  const items = useAsync(() => window.api.item.list({ search: q }), [q])
  const types = useAsync(() => window.api.itemType.list(), [])
  const groups = useAsync(() => window.api.itemGroup.list(), [])
  const designs = useAsync(() => window.api.design.list(), [])

  const reloadAll = () => { items.reload(); types.reload(); groups.reload(); designs.reload() }

  const save = async () => {
    if (!editing.name.trim()) return run(async () => { throw new Error('Item name is required') })
    if (!editing.item_type_id) return run(async () => { throw new Error('Item type is required') })
    if (!editing.item_group_id) return run(async () => { throw new Error('Item group is required') })
    const ok = await run(
      () => window.api.item.save({
        ...editing,
        item_type_id: Number(editing.item_type_id) || null,
        item_group_id: Number(editing.item_group_id) || null,
        design_id: Number(editing.design_id) || null,
        reorder_level: Number(editing.reorder_level) || 0,
      }),
      'Item saved'
    )
    if (ok !== undefined) { setEditing(null); items.reload() }
  }

  const remove = async () => {
    const ok = await run(() => window.api.item.remove({ id: confirming.id }), 'Item deleted')
    setConfirming(null)
    if (ok !== undefined) items.reload()
  }

  return (
    <div className="content-narrow">
      <div className="toolbar">
        <div className="search-box">
          <Icon.search />
          <input className="input" placeholder="Search items…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setMasterOpen('item_group')}>Item Groups</button>
        <button className="btn" onClick={() => setMasterOpen('item_type')}>Item Types</button>
        <button className="btn btn-primary" onClick={() => setEditing({ ...BLANK })}>
          <Icon.plus /> New Item
        </button>
      </div>

      <div className="card">
        <div className="card-body flush">
          {items.loading ? (
            <Loading />
          ) : !items.data?.length ? (
            <Empty icon={Icon.item} title="No items yet"
              action={<button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...BLANK })}>Create an item</button>}>
              An item is the product type — Ring, Chain, Bangle. Tags and stock hang off it.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Item Name</th><th>Type</th><th>Group</th><th>Design</th>
                    <th>Mode</th><th>UOM</th><th className="r">In Stock</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.data.map((it: any) => (
                    <tr key={it.id}>
                      <td className="strong">{it.name}</td>
                      <td>{it.type_name || '—'}</td>
                      <td>{it.group_name || '—'}</td>
                      <td>{it.design_name || '—'}</td>
                      <td>
                        <span className="badge badge-mute">
                          {it.weight_mode === 'WEIGHT' ? 'Weight-wise' : 'Quantity-wise'}
                        </span>
                      </td>
                      <td>{it.uom}</td>
                      <td className="r num">
                        {it.in_stock_count > 0
                          ? <span className="badge badge-ok">{it.in_stock_count}</span>
                          : <span className="muted">0</span>}
                      </td>
                      <td className="r">
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditing({
                          ...it,
                          item_type_id: it.item_type_id ?? '',
                          item_group_id: it.item_group_id ?? '',
                          design_id: it.design_id ?? '',
                        })} aria-label="Edit"><Icon.edit /></button>
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setConfirming(it)} aria-label="Delete"><Icon.trash /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <Modal
          title={editing.id ? 'Edit Item' : 'New Item'}
          onClose={() => setEditing(null)}
          footer={<>
            <span className="spacer" />
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}><Icon.save /> Save</button>
          </>}
        >
          <div className="form-grid cols-2">
            <Field label="Item Name" required className="span-2">
              <Input autoFocus value={editing.name} placeholder="e.g. Ring"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>

            <Field label="Item Type" required>
              <Select value={editing.item_type_id} placeholder="Select…"
                onChange={(v) => setEditing({ ...editing, item_type_id: v })}
                options={(types.data || []).map((t: any) => ({ value: t.id, label: t.name }))} />
            </Field>

            <Field label="Item Group" required hint="Sets the default purity">
              <Select value={editing.item_group_id} placeholder="Select…"
                onChange={(v) => setEditing({ ...editing, item_group_id: v })}
                options={(groups.data || []).map((g: any) => ({
                  value: g.id, label: `${g.name} · ${g.purity}%`,
                }))} />
            </Field>

            <Field label="Design">
              <Select value={editing.design_id} placeholder="None"
                onChange={(v) => setEditing({ ...editing, design_id: v })}
                options={(designs.data || []).map((d: any) => ({ value: d.id, label: d.name }))} />
            </Field>

            <Field label="Weight / Qty" required hint="How this item is counted">
              <Select value={editing.weight_mode}
                onChange={(v) => setEditing({ ...editing, weight_mode: v })}
                options={[
                  { value: 'WEIGHT', label: 'Weight-wise' },
                  { value: 'QTY', label: 'Quantity-wise' },
                ]} />
            </Field>

            <Field label="UOM" required>
              <Select value={editing.uom} onChange={(v) => setEditing({ ...editing, uom: v })}
                options={['GRAM', 'CARAT', 'PCS', 'TOLA'].map((u) => ({ value: u, label: u }))} />
            </Field>

            <Field label="HSN Code" hint="Printed on the tax invoice">
              <Input value={editing.hsn}
                onChange={(e) => setEditing({ ...editing, hsn: e.target.value })} />
            </Field>

            <Field label="Reorder Level" hint="Alert when stock of this item falls below this many pieces. 0 = off.">
              <Input className="right" inputMode="decimal" value={editing.reorder_level ?? 0}
                onChange={(e) => setEditing({ ...editing, reorder_level: e.target.value })} />
            </Field>

            <div className="span-2 hint">
              Tag prefix will be <span className="mono strong">
                {(editing.name || 'ITM').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'ITM'}
              </span> — tags generate as e.g.{' '}
              <span className="mono">
                {((editing.name || 'ITM').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'ITM')}00001
              </span>
            </div>
          </div>
        </Modal>
      )}

      {masterOpen && (
        <MasterModal kind={masterOpen} onClose={() => { setMasterOpen(null); reloadAll() }} />
      )}

      {confirming && (
        <Confirm
          title="Delete item?"
          message={`"${confirming.name}" will be removed. Items that already have stock tags cannot be deleted.`}
          onConfirm={remove}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  )
}

/* Inline master editor for item types / groups / designs. */
function MasterModal({ kind, onClose }: { kind: 'item_type' | 'item_group' | 'design'; onClose: () => void }) {
  const api = kind === 'item_type' ? window.api.itemType : kind === 'design' ? window.api.design : window.api.itemGroup
  const title = kind === 'item_type' ? 'Item Types' : kind === 'design' ? 'Designs' : 'Item Groups'
  const run = useAction()
  const list = useAsync(() => api.list(), [])
  const types = useAsync(() => window.api.itemType.list(), [])
  const [draft, setDraft] = useState<any>({ name: '', purity: 91.6, item_type_id: '' })

  const add = async () => {
    if (!draft.name.trim()) return
    const payload =
      kind === 'item_group'
        ? { name: draft.name, purity: Number(draft.purity) || 0, item_type_id: Number(draft.item_type_id) || null }
        : { name: draft.name }
    const ok = await run(() => api.save(payload), `${title.slice(0, -1)} added`)
    if (ok !== undefined) { setDraft({ name: '', purity: 91.6, item_type_id: '' }); list.reload() }
  }

  return (
    <Modal title={title} onClose={onClose}
      footer={<><span className="spacer" /><button className="btn btn-primary" onClick={onClose}>Done</button></>}>
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 14 }}>
        <Field label="Name" className="grow">
          <Input value={draft.name} placeholder={kind === 'item_group' ? 'e.g. 22K Gold' : 'e.g. Gold'}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && add()} />
        </Field>
        {kind === 'item_group' && (
          <>
            <Field label="Purity %" className="" >
              <Input className="right" style={{ width: 92 }} value={draft.purity}
                onChange={(e) => setDraft({ ...draft, purity: e.target.value })} />
            </Field>
            <Field label="Type">
              <Select value={draft.item_type_id} placeholder="—" className=""
                onChange={(v) => setDraft({ ...draft, item_type_id: v })}
                options={(types.data || []).map((t: any) => ({ value: t.id, label: t.name }))} />
            </Field>
          </>
        )}
        <button className="btn btn-primary" onClick={add}><Icon.plus /> Add</button>
      </div>

      <div className="table-wrap" style={{ border: '1px solid var(--line)', maxHeight: 320 }}>
        <table className="data">
          <thead>
            <tr><th>Name</th>{kind === 'item_group' && <><th className="r">Purity</th><th>Type</th></>}<th></th></tr>
          </thead>
          <tbody>
            {(list.data || []).map((r: any) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                {kind === 'item_group' && <><td className="r num">{r.purity}%</td><td>{r.type_name || '—'}</td></>}
                <td className="r">
                  <button className="btn btn-ghost btn-icon btn-sm"
                    onClick={async () => {
                      await run(() => api.remove({ id: r.id }), 'Deleted')
                      list.reload()
                    }} aria-label="Delete"><Icon.trash /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
