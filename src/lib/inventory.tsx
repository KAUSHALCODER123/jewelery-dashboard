import React, { useId, useMemo, useState } from 'react'
import { Field, Input, Modal, Select, useAsync, useToast } from './ui'

/** Bounded option rendering; every match is reachable with keyboard or paging. */
export function SearchSelect({ value, onChange, options, placeholder = 'Choose…', disabled, className = '', ...rest }: {
  value: any; onChange: (v: string) => void; options: {value:any; label:string}[];
  placeholder?: string; disabled?: boolean; className?: string; style?: React.CSSProperties;
  'aria-label'?: string; required?: boolean; title?: string;
}) {
  const id = useId(), [open, setOpen] = useState(false), [q, setQ] = useState(''), [active, setActive] = useState(0)
  const matches = useMemo(() => options.filter(o => o.label.toLocaleLowerCase().includes(q.toLocaleLowerCase())), [options,q])
  const start = Math.floor(active / 40)*40
  const pick = (n: number) => { if(matches[n]) { onChange(String(matches[n].value)); setOpen(false); setQ('') } }
  return <div className={`ac ${className}`} style={rest.style} onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) { setOpen(false); setQ('') }
  }}>
    <input className="input" role="combobox" aria-expanded={open} aria-controls={id}
      aria-autocomplete="list" aria-activedescendant={open && matches.length ? `${id}-${active}` : undefined}
      aria-label={rest['aria-label'] || placeholder} disabled={disabled} title={rest.title}
      value={open ? q : options.find(o => String(o.value)===String(value))?.label || ''}
      placeholder={placeholder} onFocus={() => {setOpen(true);setActive(0)}}
      onChange={e => {setQ(e.target.value);setActive(0);setOpen(true)}}
      onKeyDown={e => {
        if(e.key==='Escape') { e.stopPropagation(); setOpen(false);setQ(''); return }
        if(e.key==='ArrowDown' || e.key==='ArrowUp') { e.preventDefault();setOpen(true);setActive(a=>Math.max(0,Math.min(matches.length-1,a+(e.key==='ArrowDown'?1:-1)))); }
        if(e.key==='Enter' && open) {e.preventDefault();pick(active)}
      }} />
    {open && <div className="ac-list" id={id} role="listbox">
      {!matches.length && <div className="ac-empty">No matching options</div>}
      {matches.slice(start,start+40).map((o,i)=><button type="button" role="option" aria-selected={start+i===active}
        id={`${id}-${start+i}`} key={String(o.value)} className="ac-item" data-active={start+i===active}
        onMouseDown={e=>e.preventDefault()} onClick={()=>pick(start+i)}>{o.label}</button>)}
      {matches.length>40 && <div className="row" style={{padding:8}}>
        <button type="button" className="btn btn-sm" disabled={start===0} onClick={()=>setActive(Math.max(0,start-40))}>Previous</button>
        <span className="small">{start+1}–{Math.min(start+40,matches.length)} of {matches.length}</span>
        <button type="button" className="btn btn-sm" disabled={start+40>=matches.length} onClick={()=>setActive(start+40)}>Next</button>
      </div>}
    </div>}
  </div>
}

export function Pagination({data, onPage, disabled=false}: {data:any; onPage:(page:number)=>void; disabled?:boolean}) {
  const page=data?.page || 1, total=data?.total || 0, size=data?.pageSize || 50
  return <div className="row inventory-pager" aria-label="Result pages">
    <span className="small muted">{total ? `${(page-1)*size+1}–${Math.min(page*size,total)} of ${total}` : '0 results'}</span>
    <span className="spacer" />
    <button className="btn btn-sm" disabled={disabled || page<=1} onClick={()=>onPage(1)}>First</button>
    <button className="btn btn-sm" disabled={disabled || page<=1} onClick={()=>onPage(page-1)}>Previous</button>
    <span className="small">Page {page} of {Math.max(1,Math.ceil(total/size))}</span>
    <button className="btn btn-sm" disabled={disabled || page*size>=total} onClick={()=>onPage(page+1)}>Next</button>
    <button className="btn btn-sm" disabled={disabled || page*size>=total} onClick={()=>onPage(Math.ceil(total/size))}>Last</button>
  </div>
}

export const FILTER_LABELS: Record<string,string> = {
  metal:'Metal', group:'Purity group', designId:'Design', category:'Category', location:'Branch / location',
  shelf_tray:'Shelf / tray', size:'Size', minWeight:'Minimum net g', maxWeight:'Maximum net g',
  minPurity:'Minimum purity %', maxPurity:'Maximum purity %', huid:'HUID', printed:'Label printed', sort:'Sort',
  supplierId:'Supplier', purchaseId:'Purchase batch', entryFrom:'Entered from', entryTo:'Entered to',
  availability:'Availability',
}
export function InventoryFilters({value, onChange, disabled=false}: {value:Record<string,string>; onChange:(v:Record<string,string>)=>void; disabled?:boolean}) {
  const facets=useAsync(()=>window.api.tagStock.facets(),[]), groups=useAsync(()=>window.api.itemGroup.list(),[]), designs=useAsync(()=>window.api.design.list(),[])
  const set=(k:string,v:string)=>onChange({...value,[k]:v})
  const options:Record<string,{value:any;label:string}[]> = {
    metal:['Gold','Silver','Platinum'].map(v=>({value:v,label:v})),
    group:(groups.data||[]).map(g=>({value:g.name,label:g.name})),
    designId:(designs.data||[]).map(d=>({value:String(d.id),label:d.name})),
    ...Object.fromEntries(Object.entries(facets.data||{}).map(([k,vs])=>[k,vs.map(v=>({value:v,label:v}))])),
    huid:[{value:'PRESENT',label:'Recorded'},{value:'MISSING',label:'Missing'}],
    availability:[{value:'AVAILABLE',label:'Available to sell'},{value:'ON_HOLD',label:'On hold'}],
    sort:[{value:'tag',label:'Tag'},{value:'name',label:'Item name'},{value:'weight',label:'Net weight ↑'},{value:'newest',label:'Newest first'},{value:'oldest',label:'Oldest first'},{value:'tray',label:'Shelf / tray'}],
  }
  return <div className="card inventory-filters">
    <div className="inventory-filter-grid">
      {Object.entries(FILTER_LABELS).map(([k,label])=><Field label={label} key={k}>
        {k.startsWith('min') || k.startsWith('max') ? <Input type="number" min="0" step="any" aria-label={label} disabled={disabled} value={value[k]||''} onChange={e=>set(k,e.target.value)} />
          : <Select aria-label={label} disabled={disabled} value={value[k]||''} onChange={v=>set(k,v)} options={[{value:'',label:k==='sort'?'Tag order':`All ${label.toLowerCase()}`},...(options[k]||[])]} />}
      </Field>)}
    </div>
    <div className="row wrap" style={{marginTop:12,gap:6}}>
      {Object.entries(value).filter(([k,v])=>v && FILTER_LABELS[k]).map(([k,v])=><button className="btn btn-sm" disabled={disabled} key={k} onClick={()=>set(k,'')}>
        {FILTER_LABELS[k]}: {options[k]?.find(o=>String(o.value)===v)?.label||v} ×
      </button>)}
      <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={()=>onChange({})}>Clear filters</button>
    </div>
    {(facets.error || groups.error || designs.error) && <div role="alert">Some filter options could not be loaded. Reopen this screen to retry.</div>}
  </div>
}

/** Device-local shortcuts; payloads contain filter values only, never inventory.
 * v2 payloads carry {v:2, filters}; v1 payloads are migrated. Unknown fields are
 * discarded with a notice; stale ids fall back gracefully. */
const ALLOWED_VIEW_KEYS = new Set([...Object.keys(FILTER_LABELS), 'search', 'status', 'groupBy', 'item_type_id', 'item_group_id', 'design_id', 'stock_mode'])
function sanitizeView(v: any) {
  if (!v || typeof v !== 'object') return {}
  const src = v && typeof v.v === 'number' ? v.filters ?? v.value ?? {} : v.value ?? v.filters ?? v
  if (!src || typeof src !== 'object') return {}
  const out: Record<string, any> = {}
  for (const [k, val] of Object.entries(src)) {
    if (!ALLOWED_VIEW_KEYS.has(k)) continue
    if (typeof val !== 'string') continue
    out[k] = val.slice(0, 120)
  }
  return out
}
export function SavedViews({scope,value,onApply,disabled=false}: {scope:string;value:any;onApply:(v:any)=>void;disabled?:boolean}) {
  const key=`inventory.views.v2.${scope}`, legacy=`inventory.views.v1.${scope}`, toast=useToast()
  const [views,setViews]=useState<{name:string;value:any}[]>(()=>{
    try {
      const raw = localStorage.getItem(key) ?? localStorage.getItem(legacy) ?? '[]'
      const v=JSON.parse(raw||'[]')
      const list = Array.isArray(v)?v.filter(x=>typeof x.name==='string' && x.value && typeof x.value==='object'):[]
      return list.map(x=>({name:x.name.slice(0,80), value:sanitizeView(x)}))
    } catch{return []}
  })
  const [name,setName]=useState(''), [saving,setSaving]=useState(false), [selected,setSelected]=useState('')
  const [notice,setNotice]=useState('')
  const persist=(v:typeof views)=>{try{localStorage.setItem(key,JSON.stringify(v.map(x=>({name:x.name,value:{v:2,filters:x.value}}))));setViews(v);return true}catch{toast.push('error','Could not save views on this device');return false}}
  const apply=(n:string)=>{setSelected(n);const view=views.find(x=>x.name===n);if(!view)return;const clean=sanitizeView(view);const dropped=Object.keys(view.value||{}).filter(k=>!ALLOWED_VIEW_KEYS.has(k));onApply(clean);setNotice(dropped.length?`Removed unsupported fields: ${dropped.join(', ')}`:'')}
  return <div className="row wrap" style={{gap:8,marginBottom:12}}>
    <Select aria-label="Saved inventory views" disabled={disabled} value={selected} onChange={apply} options={[{value:'',label:'Saved views on this device'},...views.map(v=>({value:v.name,label:v.name}))]} />
    <button className="btn btn-sm" disabled={disabled} onClick={()=>{setName('');setSaving(true)}}>Save current view</button>
    {selected && <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={()=>{if(persist(views.filter(v=>v.name!==selected)))setSelected('')}}>Remove saved view</button>}
    {notice && <span className="small muted" role="status">{notice}</span>}
    {saving && <Modal title="Save inventory view" onClose={()=>setSaving(false)} footer={<button className="btn btn-primary" disabled={!name.trim()} onClick={()=>{
      if(views.some(v=>v.name.toLocaleLowerCase()===name.trim().toLocaleLowerCase())) {toast.push('error','A view with this name already exists');return}
      if(persist([...views,{name:name.trim(),value:sanitizeView({value})}])){setSelected(name.trim());setSaving(false)}
    }}>Save view</button>}><Field label="View name" hint="Saved on this device for quick access."><Input autoFocus maxLength={80} value={name} onChange={e=>setName(e.target.value)} /></Field></Modal>}
  </div>
}

/** Async paged selector for large masters: keeps bounded rendering while the
 * source pages on the backend. Falls back to sync filtering when no source. */
export function AsyncSearchSelect({ value, onChange, options, source, placeholder='Choose…', disabled }: {
  value: any; onChange:(v:string)=>void; options?: {value:any;label:string}[];
  source?: (q:string,page:number)=>Promise<{rows:any[];total:number}>;
  placeholder?: string; disabled?: boolean
}) {
  const [open,setOpen]=useState(false),[q,setQ]=useState(''),[active,setActive]=useState(0),[page,setPage]=useState(1)
  const [remote,setRemote]=useState<{rows:any[];total:number}|null>(null)
  React.useEffect(()=>{
    if(!source||!open) return
    let alive=true
    const t=setTimeout(()=>{source(q,page).then(r=>{if(alive)setRemote(r)}).catch(()=>{})},160)
    return ()=>{alive=false;clearTimeout(t)}
  },[q,page,open])
  if(!source) return <SearchSelect value={value} onChange={onChange} options={options||[]} placeholder={placeholder} disabled={disabled} />
  const rows=remote?.rows||[]
  const total=remote?.total||0
  return <div className="ac" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false)}}>
    <input className="input" role="combobox" aria-expanded={open} aria-label={placeholder} disabled={disabled}
      value={open?q:(options||[]).find(o=>String(o.value)===String(value))?.label||''}
      placeholder={placeholder} onFocus={()=>{setOpen(true);setPage(1)}}
      onChange={e=>{setQ(e.target.value);setPage(1);setOpen(true)}}
      onKeyDown={e=>{if(e.key==='Escape'){setOpen(false)} if(e.key==='ArrowDown'){e.preventDefault();setActive(a=>Math.min(a+1,rows.length-1))} if(e.key==='Enter'&&rows[active]){onChange(String(rows[active].value??rows[active].id));setOpen(false)}}}/>
    {open && <div className="ac-list" role="listbox">
      {!rows.length && <div className="ac-empty">No matching options</div>}
      {rows.map((o:any,i:number)=><button type="button" key={String(o.value??o.id)} className="ac-item" data-active={i===active} onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange(String(o.value??o.id));setOpen(false)}}>{o.label??o.name}</button>)}
      {total>rows.length && <div className="row" style={{padding:8}}><span className="small">{rows.length} of {total}</span><span className="spacer"/><button type="button" className="btn btn-sm" onClick={()=>setPage(p=>p+1)}>More</button></div>}
    </div>}
  </div>
}
