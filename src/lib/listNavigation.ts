import { useEffect } from 'react'

/** Pick an option the way a click would, so React's onChange sees it. */
function choose(sel: HTMLSelectElement, index: number) {
  if (index < 0 || index >= sel.options.length || index === sel.selectedIndex) return
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  setter.call(sel, sel.options[index].value)
  sel.dispatchEvent(new Event('change', { bubbles: true }))
}

/** The next field in the page's Tab order — where Enter goes from a dropdown. */
function nextField(from: HTMLElement) {
  const all = [...document.querySelectorAll<HTMLElement>(
    'input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((el) => el.offsetParent !== null || el === from)
  return all[all.indexOf(from) + 1]
}

/**
 * With the option on, Tab walks DOWN a list instead of across the form — the
 * counter asked for it after pressing Tab in "From purchase" and landing in
 * the next box:
 *   - a dropdown: Tab / Shift+Tab choose the next / previous option, and Enter
 *     moves on to the next field;
 *   - an open suggestion list (item, customer, palette): Tab / Shift+Tab move
 *     the highlight like the arrow keys, and Enter picks as before.
 */
function onKey(e: KeyboardEvent) {
  if (e.ctrlKey || e.altKey || e.metaKey) return
  const t = e.target
  if (t instanceof HTMLSelectElement && !t.multiple) {
    if (e.key === 'Tab') {
      e.preventDefault()
      choose(t, t.selectedIndex + (e.shiftKey ? -1 : 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      nextField(t)?.focus()
    }
    return
  }
  if (e.key === 'Tab' && t instanceof HTMLInputElement) {
    const box = t.parentElement
    const list = box?.querySelector('.ac-list, .palette-list')
    if (list && list.querySelector('.ac-item, .palette-item')) {
      e.preventDefault()
      t.dispatchEvent(new KeyboardEvent('keydown', {
        key: e.shiftKey ? 'ArrowUp' : 'ArrowDown', bubbles: true, cancelable: true,
      }))
      list.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
    }
  }
}

export function useListNavigation() {
  useEffect(() => {
    let enabled = localStorage.getItem('tab-list-navigation') === 'true'
    const refresh = () => {
      enabled = localStorage.getItem('tab-list-navigation') === 'true'
      // Off and nothing left to undo: skip the scan, which runs on every DOM change.
      if (!enabled && !document.querySelector('[data-tab-navigation]')) return
      document.querySelectorAll<HTMLTableRowElement>('table.data tbody tr').forEach(row => {
        if (enabled && !row.hasAttribute('tabindex')) { row.tabIndex = 0; row.dataset.tabNavigation = 'true' }
        if (!enabled && row.dataset.tabNavigation) { row.removeAttribute('tabindex'); delete row.dataset.tabNavigation }
      })
    }
    const observer = new MutationObserver(refresh)
    observer.observe(document.body, { childList: true, subtree: true })
    const focus = (e: FocusEvent) => {
      if (enabled && e.target instanceof HTMLElement && e.target.closest('table, .ac-list')) e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    const key = (e: KeyboardEvent) => { if (enabled) onKey(e) }
    refresh()
    window.addEventListener('list-navigation-change', refresh)
    document.addEventListener('focusin', focus)
    // Capture phase, so this runs before a field's own Tab handling.
    document.addEventListener('keydown', key, true)
    return () => {
      observer.disconnect(); window.removeEventListener('list-navigation-change', refresh)
      document.removeEventListener('focusin', focus); document.removeEventListener('keydown', key, true)
    }
  }, [])
}
