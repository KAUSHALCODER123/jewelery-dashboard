const { contextBridge, ipcRenderer } = require('electron')

/**
 * Unwrap the { ok, data, error } envelope from main so callers can just `await`
 * a value and use try/catch for failures.
 */
async function call(channel, payload) {
  const res = await ipcRenderer.invoke(channel, payload)
  if (res && typeof res === 'object' && 'ok' in res) {
    if (!res.ok) throw new Error(res.error || 'Operation failed')
    return res.data
  }
  return res
}

const group = (name, methods) =>
  Object.fromEntries(methods.map((m) => [m, (payload) => call(`${name}:${m}`, payload)]))

contextBridge.exposeInMainWorld('api', {
  auth: group('auth', [
    'status', 'login', 'logout', 'list', 'addUser', 'setActive', 'setRole',
    'changePassword', 'resetPassword', 'removeUser', 'permissions',
  ]),

  company: group('company', ['read', 'save']),
  settings: group('settings', ['all', 'set']),

  itemType: group('itemType', ['list', 'save', 'remove']),
  itemGroup: group('itemGroup', ['list', 'save', 'remove']),
  design: group('design', ['list', 'save', 'remove']),
  item: group('item', ['list', 'save', 'remove']),
  rateMaster: group('rateMaster', ['list', 'save', 'remove', 'resolve']),
  gridPref: group('gridPref', ['read', 'save', 'reset', 'all']),
  branch: group('branch', ['list', 'save', 'remove', 'stock']),
  stockTransfer: group('stockTransfer', ['list', 'read', 'save', 'remove']),

  tagStock: group('tagStock', [
    'list', 'nextTag', 'saveBatch', 'updateRows', 'remove', 'findByTag', 'search',
    'markPrinted', 'clearPrinted',
  ]),
  looseStock: group('looseStock', ['summary', 'ledger', 'convert', 'opening', 'openingBalances']),
  looseItem: group('looseItem', ['balances', 'ledger', 'opening', 'adjust']),
  party: group('party', ['list', 'read', 'balance', 'metalBalance', 'loyaltyBalance', 'save', 'remove']),
  account: group('account', ['list', 'save', 'nextCode']),
  series: group('series', ['list', 'peek', 'save']),

  sale: group('sale', ['list', 'read', 'save', 'remove', 'forPrint']),
  urd: group('urd', ['list', 'read', 'save', 'remove', 'forPrint']),
  purchase: group('purchase', ['list', 'read', 'save', 'remove', 'tally', 'openForTagging']),
  refinery: group('refinery', ['list', 'read', 'save', 'remove']),
  order: group('order', ['list', 'read', 'save', 'setStatus', 'remove', 'toInvoice']),
  voucher: group('voucher', ['list', 'save', 'remove']),
  stockSettlement: group('stockSettlement', ['list', 'read', 'save', 'remove']),
  karagir: group('karagir', ['ledger', 'issue', 'receive', 'removeIssue', 'removeReceive']),
  saleReturn: group('saleReturn', ['list', 'read', 'save', 'remove']),
  purchaseReturn: group('purchaseReturn', ['list', 'read', 'save', 'remove']),
  gss: group('gss', [
    'schemes', 'saveScheme', 'removeScheme', 'types', 'merge',
    'accounts', 'readAccount', 'assign', 'balance',
    'receive', 'unreceive', 'closeAccount', 'removeAccount',
  ]),

  reports: group('reports', [
    'stock', 'ledger', 'metalLedger', 'accountCumStock', 'metalOutstanding', 'orderTracking',
    'dayBook', 'oldGold', 'outstanding', 'outstandingList', 'reorder', 'gstRegister', 'dashboard',
    'trialBalance', 'profitAndLoss', 'balanceSheet',
    'cashBook', 'journal', 'register',
    'gstReturn', 'gstSummary', 'hsnSummary', 'tcsTds', 'schemeReport', 'mis', 'reconcile',
  ]),
  calc: group('calc', ['saleTotals', 'urdTotals', 'amountInWords']),

  print: {
    html: (payload) => ipcRenderer.invoke('print:html', payload),
    pdf: (payload) => ipcRenderer.invoke('print:pdf', payload),
  },
  file: {
    saveText: (payload) => ipcRenderer.invoke('file:saveText', payload),
  },
  backup: {
    create: () => ipcRenderer.invoke('backup:create'),
    /** Read a chosen backup and report what it holds. Changes nothing. */
    inspect: () => ipcRenderer.invoke('backup:inspect'),
    /** Replace the live books with that backup, then restart the app. */
    restore: (p) => ipcRenderer.invoke('backup:restore', p),
    /** Counts of what is in the books now. Changes nothing. */
    current: () => ipcRenderer.invoke('backup:current'),
    /** Delete every entry, keep the setup, then restart. Needs { confirm: 'DELETE' }. */
    clearEntries: (p) => ipcRenderer.invoke('backup:clearEntries', p),
  },
  gdrive: group('gdrive', [
    'status', 'saveCredentials', 'connect', 'disconnect',
    'setAutoDaily', 'backupNow', 'listBackups', 'openFolder',
  ]),
  /** Read-only phone view over the shop Wi-Fi. Owner only. */
  mobile: group('mobile', ['status', 'qr', 'setEnabled', 'setPort']),
  /** Hands a URL to the OS — used for WhatsApp / SMS / email. Nothing is sent by the app. */
  send: {
    whatsapp: (p) => ipcRenderer.invoke('send:whatsapp', p),
    sms: (p) => ipcRenderer.invoke('send:sms', p),
    email: (p) => ipcRenderer.invoke('send:email', p),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
  },
})
