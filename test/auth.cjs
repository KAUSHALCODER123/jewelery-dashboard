/**
 * Authentication and role permissions.
 * Includes the cases that matter for a shop: wrong passwords, disabled logins,
 * and staff being unable to do owner-only things.
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

let pass = 0, fail = 0
const bugs = []
const check = (label, actual, expected) => {
  const good = String(actual) === String(expected)
  if (good) { pass++; console.log(`   ok   ${label}  =  ${actual}`) }
  else { fail++; bugs.push(`${label}: got ${actual}, expected ${expected}`)
         console.log(`   FAIL ${label}: got ${actual}, expected ${expected}`) }
}
const rejects = (label, fn) => {
  try { fn(); fail++; bugs.push(`${label}: allowed but should be blocked`)
        console.log(`   FAIL ${label}: allowed, should be blocked`) }
  catch { pass++; console.log(`   ok   ${label}  =  blocked`) }
}
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 54 - t.length))}`)

// Give each run its own Chromium profile — otherwise two test processes
// fight over the same cache directory and the slower one flakes.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-auth-'))
  require('../electron/db.cjs').open(tmp)
  const { auth, bootstrap, can, session, hashPassword } = require('../electron/auth.cjs')
  const api = require('../electron/api.cjs')

  try {
    head('1. First run creates the owner')
    bootstrap()
    bootstrap()  // must be safe to run twice
    auth.login({ username: 'admin', password: 'admin' })
    check('only one account exists', auth.list().length, 1)
    check('it is the owner', auth.list()[0].role, 'owner')
    check('default password is flagged', auth.status().defaultPassword, true)

    head('2. Signing in')
    auth.logout()
    check('signed out', auth.status().user, 'null')
    rejects('wrong password refused', () => auth.login({ username: 'admin', password: 'nope' }))
    rejects('unknown user refused', () => auth.login({ username: 'ghost', password: 'admin' }))
    const me = auth.login({ username: 'ADMIN', password: 'admin' })
    check('username is case-insensitive', me.username, 'admin')
    check('session now holds the user', auth.status().user.role, 'owner')
    check('last login recorded', auth.list()[0].last_login !== '', true)

    head('3. Passwords are stored safely')
    const db = require('../electron/db.cjs').get()
    const row = db.prepare(`SELECT * FROM app_user WHERE username='admin'`).get()
    check('raw password is never stored', row.password_hash.includes('admin'), false)
    check('salt is present', row.salt.length, 32)
    check('hash is scrypt-length', row.password_hash.length, 128)
    // Same password, different salt must give a different hash.
    check('salt makes hashes unique',
      hashPassword('admin', 'aaaa') === hashPassword('admin', 'bbbb'), false)

    head('4. Creating staff')
    const staff = auth.addUser({ username: 'ramesh', name: 'Ramesh Patil', role: 'staff', password: 'shop123' })
    check('staff created', staff.username, 'ramesh')
    check('role assigned', staff.role, 'staff')
    const mgr = auth.addUser({ username: 'suresh', name: 'Suresh', role: 'manager', password: 'shop123' })
    check('manager created', mgr.role, 'manager')
    rejects('duplicate username refused',
      () => auth.addUser({ username: 'Ramesh', name: 'X', role: 'staff', password: 'abcd' }))
    rejects('short password refused',
      () => auth.addUser({ username: 'x', name: 'X', role: 'staff', password: '12' }))
    rejects('invalid role refused',
      () => auth.addUser({ username: 'y', name: 'Y', role: 'superuser', password: 'abcd' }))

    head('5. What each role may do')
    const matrix = [
      ['staff',   { daily: true,  irreversible_stock: false, permanent_delete: false, manage_users: false }],
      ['manager', { daily: true,  irreversible_stock: true,  permanent_delete: false, manage_users: false }],
      ['owner',   { daily: true,  irreversible_stock: true,  permanent_delete: true,  manage_users: true  }],
    ]
    for (const [role, expect] of matrix) {
      for (const [action, allowed] of Object.entries(expect)) {
        check(`${role} · ${action}`, can(role, action), allowed)
      }
    }
    check('legacy "cashier" maps to staff', can('cashier', 'manage_users'), false)

    head('6. Staff cannot do owner work')
    auth.logout()
    auth.login({ username: 'ramesh', password: 'shop123' })
    check('signed in as staff', auth.status().user.role, 'staff')
    rejects('staff cannot create logins',
      () => auth.addUser({ username: 'z', name: 'Z', role: 'staff', password: 'abcd' }))
    rejects('staff cannot disable anyone', () => auth.setActive({ id: mgr.id, active: false }))
    rejects('staff cannot reset a password',
      () => auth.resetPassword({ id: mgr.id, newPassword: 'hacked' }))
    rejects('staff cannot delete a login', () => auth.removeUser({ id: mgr.id }))
    // Day-to-day work must still be possible. The range is derived from the
    // current year so this does not quietly stop covering anything in January.
    const yr = new Date().getFullYear()
    check('staff can read the day book',
      typeof api.reports.dayBook({ from: `${yr}-01-01`, to: `${yr}-12-31` }).cash.closing, 'number')

    head('7. Changing your own password')
    rejects('wrong current password refused',
      () => auth.changePassword({ currentPassword: 'wrong', newPassword: 'newpass' }))
    auth.changePassword({ currentPassword: 'shop123', newPassword: 'newpass' })
    auth.logout()
    rejects('old password no longer works',
      () => auth.login({ username: 'ramesh', password: 'shop123' }))
    check('new password works', auth.login({ username: 'ramesh', password: 'newpass' }).username, 'ramesh')

    head('8. Owner managing staff')
    auth.logout()
    auth.login({ username: 'admin', password: 'admin' })
    auth.setActive({ id: staff.id, active: false })
    auth.logout()
    rejects('a disabled login cannot sign in',
      () => auth.login({ username: 'ramesh', password: 'newpass' }))
    auth.login({ username: 'admin', password: 'admin' })
    auth.setActive({ id: staff.id, active: true })
    auth.resetPassword({ id: staff.id, newPassword: 'reset99' })
    auth.logout()
    check('reset password works', auth.login({ username: 'ramesh', password: 'reset99' }).username, 'ramesh')

    head('9. Protecting the built-in admin')
    auth.logout()
    auth.login({ username: 'admin', password: 'admin' })
    const adminRow = auth.list().find((u) => u.username === 'admin')
    rejects('admin cannot be disabled', () => auth.setActive({ id: adminRow.id, active: false }))
    rejects('admin cannot be deleted', () => auth.removeUser({ id: adminRow.id }))
    rejects('cannot remove your own owner access',
      () => auth.setRole({ id: adminRow.id, role: 'staff' }))

    head('10. Nothing works when signed out')
    auth.logout()
    rejects('listing users needs a session', () => auth.list())
    rejects('session.require blocks everything', () => session.require('daily'))
    check('status is still readable', typeof auth.status().userCount, 'number')

    head('11. Default-password warning clears')
    auth.login({ username: 'admin', password: 'admin' })
    auth.changePassword({ currentPassword: 'admin', newPassword: 'strongpass' })
    check('warning gone once changed', auth.status().defaultPassword, false)

  } catch (e) {
    fail++
    bugs.push('UNCAUGHT: ' + e.message)
    console.error('\nUNCAUGHT\n', e.stack || e.message)
  }

  console.log('\n' + '='.repeat(62))
  console.log(`  ${pass} passed, ${fail} failed`)
  if (bugs.length) { console.log('\n  Failures:'); bugs.forEach((b) => console.log('   - ' + b)) }
  console.log('='.repeat(62))
  process.exit(fail ? 1 : 0)
})
