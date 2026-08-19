/**
 * Users, login and role permissions.
 *
 * Ported from the reference app (roles, bootstrap, permission matrix, staff
 * creation). Two deliberate changes for this build:
 *
 *  1. Passwords use **scrypt** rather than salted SHA-256. SHA-256 is fast, which
 *     is exactly what you do not want in a password hash — a stolen database file
 *     could be brute-forced quickly. scrypt is memory-hard and ships with Node,
 *     so it costs nothing here. Same stored shape (salt + hash), so the table
 *     layout is unchanged.
 *  2. The signed-in user is held in the **main process**, not only the renderer,
 *     and every restricted IPC channel is checked there. Renderer-only checks can
 *     be bypassed by anyone who opens developer tools.
 */
const crypto = require('node:crypto')
const { get } = require('./db.cjs')

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }
const nowIso = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

const randomSalt = () => crypto.randomBytes(16).toString('hex')

function hashPassword(password, salt) {
  return crypto
    .scryptSync(String(password), String(salt), SCRYPT.keylen, {
      N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
    })
    .toString('hex')
}

/** Constant-time compare so a wrong password cannot be found by timing. */
function sameHash(a, b) {
  const ba = Buffer.from(String(a), 'hex')
  const bb = Buffer.from(String(b), 'hex')
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}

/* ───────────────────────────── Roles & permissions ───────────────────────────── */

const ROLES = ['owner', 'manager', 'staff']

/** Older builds called the lowest role "cashier". */
const normalizeRole = (role) =>
  role === 'cashier' ? 'staff'
    : role === 'owner' || role === 'manager' ? role
    : 'staff'

/**
 * What each role may do.
 *   daily / reasoned    — everyone (billing, receipts, day-to-day work)
 *   irreversible_stock  — manager and owner (melting metal, deleting a tag)
 *   everything else     — owner only
 */
function can(role, action) {
  const r = normalizeRole(role)
  if (action === 'daily' || action === 'reasoned') return true
  if (action === 'irreversible_stock') return r === 'manager' || r === 'owner'
  return r === 'owner'
}

function assertAllowed(role, action) {
  if (!can(role, action)) {
    throw new Error('This action is restricted to an authorised role')
  }
}

/* ───────────────────────────── Session (main process) ───────────────────────────── */

let currentUser = null

const session = {
  get: () => currentUser,
  set: (u) => { currentUser = u },
  clear: () => { currentUser = null },
  /** Throw unless someone is signed in and holds the permission. */
  require(action = 'daily') {
    if (!currentUser) throw new Error('Please sign in to continue')
    assertAllowed(currentUser.role, action)
    return currentUser
  },
}

/* ───────────────────────────── Users ───────────────────────────── */

const publicUser = (u) => ({
  id: u.id, username: u.username, name: u.name,
  role: u.role, active: !!u.active, last_login: u.last_login, created_at: u.created_at,
})

const findByUsername = (username) =>
  get().prepare(`SELECT * FROM app_user WHERE username = ? COLLATE NOCASE`)
    .get(String(username || '').trim())

/** Create the default owner on a fresh database. Safe to call repeatedly. */
function bootstrap() {
  const db = get()
  db.prepare(`UPDATE app_user SET role = 'staff' WHERE role = 'cashier'`).run()
  const count = db.prepare(`SELECT COUNT(*) c FROM app_user`).get().c
  if (count === 0) {
    const salt = randomSalt()
    db.prepare(
      `INSERT INTO app_user (username, name, role, password_hash, salt, active)
       VALUES ('admin', 'Owner', 'owner', ?, ?, 1)`
    ).run(hashPassword('admin', salt), salt)
  }
}

const auth = {
  /** Is anyone signed in right now? Also reports whether setup is still on defaults. */
  status: () => {
    const db = get()
    const users = db.prepare(`SELECT COUNT(*) c FROM app_user WHERE active = 1`).get().c
    const admin = findByUsername('admin')
    return {
      user: currentUser,
      userCount: users,
      // Warn while the shipped admin/admin password is still in place.
      defaultPassword: !!(admin && sameHash(admin.password_hash, hashPassword('admin', admin.salt))),
    }
  },

  login: ({ username, password }) => {
    const u = findByUsername(username)
    // Same message either way — never reveal which usernames exist.
    if (!u) throw new Error('Invalid username or password')
    if (!u.active) throw new Error('This account is disabled')
    if (!sameHash(u.password_hash, hashPassword(password, u.salt))) {
      throw new Error('Invalid username or password')
    }
    get().prepare(`UPDATE app_user SET last_login = ? WHERE id = ?`).run(nowIso(), u.id)
    currentUser = { id: u.id, username: u.username, name: u.name, role: normalizeRole(u.role) }
    return currentUser
  },

  logout: () => { currentUser = null; return true },

  list: () => {
    session.require('daily')
    return get().prepare(`SELECT * FROM app_user ORDER BY username`).all().map(publicUser)
  },

  /** Create a staff / manager / owner login. Owner only. */
  addUser: ({ username, name, role, password }) => {
    session.require('manage_users')
    const uname = String(username || '').trim()
    if (!uname) throw new Error('Username is required')
    if (!String(name || '').trim()) throw new Error('Full name is required')
    if (String(password || '').length < 4) throw new Error('Password must be at least 4 characters')
    if (!ROLES.includes(role)) throw new Error('Choose a valid role')
    if (findByUsername(uname)) throw new Error('Username already exists')

    const salt = randomSalt()
    const id = get()
      .prepare(
        `INSERT INTO app_user (username, name, role, password_hash, salt, active)
         VALUES (?,?,?,?,?,1)`
      )
      .run(uname, String(name).trim(), role, hashPassword(password, salt), salt).lastInsertRowid
    return publicUser(get().prepare(`SELECT * FROM app_user WHERE id = ?`).get(id))
  },

  setActive: ({ id, active }) => {
    session.require('manage_users')
    const u = get().prepare(`SELECT * FROM app_user WHERE id = ?`).get(id)
    if (!u) throw new Error('User not found')
    if (u.username.toLowerCase() === 'admin' && !active) {
      throw new Error('The built-in admin account cannot be disabled')
    }
    if (currentUser && currentUser.id === id && !active) {
      throw new Error('You cannot disable your own account')
    }
    get().prepare(`UPDATE app_user SET active = ? WHERE id = ?`).run(active ? 1 : 0, id)
    return true
  },

  setRole: ({ id, role }) => {
    session.require('manage_users')
    if (!ROLES.includes(role)) throw new Error('Choose a valid role')
    if (currentUser && currentUser.id === id && role !== 'owner') {
      throw new Error('You cannot remove your own owner access')
    }
    get().prepare(`UPDATE app_user SET role = ? WHERE id = ?`).run(role, id)
    return true
  },

  /** Change your own password — requires the current one. */
  changePassword: ({ currentPassword, newPassword }) => {
    const me = session.require('daily')
    const u = get().prepare(`SELECT * FROM app_user WHERE id = ?`).get(me.id)
    if (!sameHash(u.password_hash, hashPassword(currentPassword, u.salt))) {
      throw new Error('Current password is incorrect')
    }
    if (String(newPassword || '').length < 4) {
      throw new Error('New password must be at least 4 characters')
    }
    const salt = randomSalt()
    get().prepare(`UPDATE app_user SET salt = ?, password_hash = ? WHERE id = ?`)
      .run(salt, hashPassword(newPassword, salt), me.id)
    return true
  },

  /** Owner resetting someone else's forgotten password. */
  resetPassword: ({ id, newPassword }) => {
    session.require('manage_users')
    if (String(newPassword || '').length < 4) {
      throw new Error('Password must be at least 4 characters')
    }
    const salt = randomSalt()
    get().prepare(`UPDATE app_user SET salt = ?, password_hash = ? WHERE id = ?`)
      .run(salt, hashPassword(newPassword, salt), id)
    return true
  },

  removeUser: ({ id }) => {
    session.require('manage_users')
    const u = get().prepare(`SELECT * FROM app_user WHERE id = ?`).get(id)
    if (!u) throw new Error('User not found')
    if (u.username.toLowerCase() === 'admin') throw new Error('The built-in admin account cannot be deleted')
    if (currentUser && currentUser.id === id) throw new Error('You cannot delete your own account')
    get().prepare(`DELETE FROM app_user WHERE id = ?`).run(id)
    return true
  },

  /** So the UI can hide what the signed-in user may not do. */
  permissions: () => {
    const r = currentUser?.role
    return {
      role: r ?? null,
      manage_users: can(r, 'manage_users'),
      permanent_delete: can(r, 'permanent_delete'),
      irreversible_stock: can(r, 'irreversible_stock'),
      restore_backup: can(r, 'restore_backup'),
    }
  },
}

module.exports = {
  auth, session, bootstrap,
  can, assertAllowed, normalizeRole, ROLES,
  hashPassword, randomSalt,
}
