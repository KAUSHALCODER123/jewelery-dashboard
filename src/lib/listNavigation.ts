import { useEffect } from 'react'

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
    refresh()
    window.addEventListener('list-navigation-change', refresh)
    document.addEventListener('focusin', focus)
    return () => { observer.disconnect(); window.removeEventListener('list-navigation-change', refresh); document.removeEventListener('focusin', focus) }
  }, [])
}
