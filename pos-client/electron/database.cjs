/**
 * WashBubbles Local Database (SQLite via better-sqlite3)
 * Offline-first storage for POS operations
 */
const path = require('path')
const { app } = require('electron')

let Database
try {
  Database = require('better-sqlite3')
} catch (e) {
  console.error('[DB] better-sqlite3 not installed. Run: npm install better-sqlite3')
  Database = null
}

let db = null

const DB_VERSION = 1

/** Get path to the database file in user data directory */
function getDbPath() {
  const userDataPath = app ? app.getPath('userData') : path.join(__dirname, '..', 'data')
  return path.join(userDataPath, 'washbubbles.db')
}

/** Initialize the database */
function initDatabase(dbPath) {
  if (db) return db
  const resolvedPath = dbPath || getDbPath()

  // Ensure directory exists
  const fs = require('fs')
  const dir = path.dirname(resolvedPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  if (!Database) throw new Error('better-sqlite3 not available')

  db = new Database(resolvedPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  runMigrations()
  console.log(`[DB] Initialized at ${resolvedPath}`)
  return db
}

/** Run schema migrations */
function runMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS db_meta (key TEXT PRIMARY KEY, value TEXT)`)

  const row = db.prepare(`SELECT value FROM db_meta WHERE key = 'version'`).get()
  const currentVersion = row ? parseInt(row.value, 10) : 0

  if (currentVersion < 1) migrateV1()

  db.prepare(`INSERT OR REPLACE INTO db_meta (key, value) VALUES ('version', ?)`).run(String(DB_VERSION))
}

function migrateV1() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      local_id TEXT UNIQUE,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      number INTEGER,
      brand TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      status TEXT DEFAULT 'free',
      status_text TEXT,
      cycle INTEGER DEFAULT 0,
      weight REAL DEFAULT 0,
      type TEXT DEFAULT 'wash',
      icon TEXT,
      int_id INTEGER,
      channel INTEGER,
      impulses TEXT DEFAULT '1',
      reserved INTEGER DEFAULT 0,
      reserved_by TEXT,
      reserved_at TEXT,
      reservation_duration INTEGER DEFAULT 0,
      current_program TEXT,
      started_at TEXT,
      estimated_end_time TEXT,
      running_duration INTEGER DEFAULT 0,
      interface_id TEXT,
      port INTEGER,
      activation TEXT DEFAULT 'high',
      t_imp REAL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced INTEGER DEFAULT 0,
      last_synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      local_id TEXT UNIQUE,
      tenant_id TEXT NOT NULL,
      code TEXT NOT NULL,
      balance REAL DEFAULT 0,
      name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      contribuinte TEXT DEFAULT '',
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced INTEGER DEFAULT 0,
      last_synced_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_tenant_code ON cards(tenant_id, code);

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      local_id TEXT UNIQUE NOT NULL,
      tenant_id TEXT NOT NULL,
      machine_id TEXT,
      amount REAL NOT NULL,
      items TEXT,
      type TEXT DEFAULT 'payment',
      method TEXT,
      batch_id TEXT,
      card_id TEXT,
      card_code TEXT,
      inserted REAL DEFAULT 0,
      change_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      synced INTEGER DEFAULT 0,
      last_synced_at TEXT,
      sync_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sales_tenant_date ON sales(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_synced ON sales(synced);

    CREATE TABLE IF NOT EXISTS prices (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL NOT NULL,
      duration INTEGER,
      cash_price REAL NOT NULL DEFAULT 0,
      card_price REAL NOT NULL DEFAULT 0,
      promo_active INTEGER DEFAULT 0,
      promo_cash_price REAL,
      promo_card_price REAL,
      promo_start_time TEXT,
      promo_end_time TEXT,
      promo_days TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prices_lookup ON prices(tenant_id, type, weight);

    CREATE TABLE IF NOT EXISTS interfaces (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      brand TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial_number TEXT NOT NULL,
      address INTEGER NOT NULL,
      ports INTEGER DEFAULT 2,
      t_on INTEGER DEFAULT 100,
      t_off INTEGER DEFAULT 100,
      status TEXT DEFAULT 'inactive',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS peripherals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      protocol TEXT DEFAULT 'pulse',
      address TEXT DEFAULT '',
      baud_rate TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      status TEXT DEFAULT 'unknown',
      image TEXT DEFAULT '',
      hopper_config TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_tenant_key ON settings(tenant_id, key);

    CREATE TABLE IF NOT EXISTS sync_outbound (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      attempts INTEGER DEFAULT 0,
      last_attempt_at TEXT,
      status TEXT DEFAULT 'pending',
      error TEXT,
      priority INTEGER DEFAULT 5
    );
    CREATE INDEX IF NOT EXISTS idx_sync_outbound_status ON sync_outbound(status, priority);

    CREATE TABLE IF NOT EXISTS sync_meta (
      entity_type TEXT PRIMARY KEY,
      last_synced_at TEXT,
      last_pushed_at TEXT,
      server_version TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      local_data TEXT NOT NULL,
      server_data TEXT NOT NULL,
      resolution TEXT,
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cash_balance REAL DEFAULT 0,
      card_code TEXT,
      card_balance REAL DEFAULT 0,
      has_card INTEGER DEFAULT 0,
      bonus REAL DEFAULT 0,
      money_arr TEXT DEFAULT '[]',
      bonus_arr TEXT DEFAULT '[]',
      charged_arr TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `)
}

// ─── CRUD Helpers ───

function generateId() {
  const { randomUUID } = require('crypto')
  return randomUUID()
}

// Machines
const machines = {
  getAll(tenantId) {
    return db.prepare('SELECT * FROM machines WHERE tenant_id = ? ORDER BY number ASC, created_at ASC').all(tenantId)
  },
  getById(id) {
    return db.prepare('SELECT * FROM machines WHERE id = ?').get(id)
  },
  getByIntId(intId) {
    return db.prepare('SELECT * FROM machines WHERE int_id = ?').get(intId)
  },
  upsert(machine) {
    const stmt = db.prepare(`INSERT OR REPLACE INTO machines
      (id, local_id, tenant_id, name, number, brand, model, serial_number, status, status_text,
       cycle, weight, type, icon, int_id, channel, impulses, reserved, reserved_by, reserved_at,
       reservation_duration, current_program, started_at, estimated_end_time, running_duration,
       interface_id, port, activation, t_imp, created_at, updated_at, synced, last_synced_at)
      VALUES (@id, @local_id, @tenant_id, @name, @number, @brand, @model, @serial_number, @status, @status_text,
       @cycle, @weight, @type, @icon, @int_id, @channel, @impulses, @reserved, @reserved_by, @reserved_at,
       @reservation_duration, @current_program, @started_at, @estimated_end_time, @running_duration,
       @interface_id, @port, @activation, @t_imp, @created_at, @updated_at, @synced, @last_synced_at)`)
    return stmt.run(machine)
  },
  updateStatus(id, status, statusText) {
    return db.prepare('UPDATE machines SET status = ?, status_text = ?, updated_at = datetime("now") WHERE id = ?').run(status, statusText, id)
  },
  incrementCycle(id) {
    return db.prepare('UPDATE machines SET cycle = cycle + 1, updated_at = datetime("now") WHERE id = ?').run(id)
  },
  bulkUpsert(machinesArr) {
    const upsertMany = db.transaction((items) => {
      for (const m of items) machines.upsert(m)
    })
    upsertMany(machinesArr)
  }
}

// Cards
const cards = {
  getAll(tenantId) {
    return db.prepare('SELECT * FROM cards WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId)
  },
  getByCode(tenantId, code) {
    return db.prepare('SELECT * FROM cards WHERE tenant_id = ? AND code = ?').get(tenantId, code)
  },
  getById(id) {
    return db.prepare('SELECT * FROM cards WHERE id = ?').get(id)
  },
  upsert(card) {
    return db.prepare(`INSERT OR REPLACE INTO cards
      (id, local_id, tenant_id, code, balance, name, email, phone, contribuinte, metadata,
       created_at, updated_at, synced, last_synced_at)
      VALUES (@id, @local_id, @tenant_id, @code, @balance, @name, @email, @phone, @contribuinte, @metadata,
       @created_at, @updated_at, @synced, @last_synced_at)`).run(card)
  },
  updateBalance(id, newBalance) {
    return db.prepare('UPDATE cards SET balance = ?, updated_at = datetime("now"), synced = 0 WHERE id = ?').run(newBalance, id)
  },
  bulkUpsert(cardsArr) {
    const upsertMany = db.transaction((items) => {
      for (const c of items) cards.upsert(c)
    })
    upsertMany(cardsArr)
  }
}

// Sales
const sales = {
  create(sale) {
    const id = sale.id || generateId()
    const localId = sale.local_id || generateId()
    return db.prepare(`INSERT INTO sales
      (id, local_id, tenant_id, machine_id, amount, items, type, method, batch_id, card_id, card_code,
       inserted, change_amount, created_at, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(
      id, localId, sale.tenant_id, sale.machine_id || null, sale.amount,
      JSON.stringify(sale.items || null), sale.type || 'payment', sale.method || null,
      sale.batch_id || null, sale.card_id || null, sale.card_code || null,
      sale.inserted || 0, sale.change_amount || 0, sale.created_at || new Date().toISOString()
    )
  },
  getAll(tenantId, limit = 100) {
    return db.prepare('SELECT * FROM sales WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?').all(tenantId, limit)
  },
  getByCardCode(tenantId, code, limit = 30) {
    return db.prepare('SELECT * FROM sales WHERE tenant_id = ? AND card_code = ? ORDER BY created_at DESC LIMIT ?').all(tenantId, code, limit)
  },
  getUnsynced(limit = 50) {
    return db.prepare('SELECT * FROM sales WHERE synced = 0 ORDER BY created_at ASC LIMIT ?').all(limit)
  },
  markSynced(id, serverId) {
    return db.prepare('UPDATE sales SET synced = 1, last_synced_at = datetime("now"), id = COALESCE(?, id) WHERE local_id = ? OR id = ?').run(serverId, id, id)
  }
}

// Prices
const prices = {
  getAll(tenantId) {
    return db.prepare('SELECT * FROM prices WHERE tenant_id = ? ORDER BY type, weight').all(tenantId)
  },
  lookup(tenantId, type, weight) {
    return db.prepare('SELECT * FROM prices WHERE tenant_id = ? AND type = ? AND weight = ?').get(tenantId, type, weight)
  },
  upsert(price) {
    return db.prepare(`INSERT OR REPLACE INTO prices
      (id, tenant_id, type, weight, duration, cash_price, card_price,
       promo_active, promo_cash_price, promo_card_price, promo_start_time, promo_end_time, promo_days,
       created_at, updated_at)
      VALUES (@id, @tenant_id, @type, @weight, @duration, @cash_price, @card_price,
       @promo_active, @promo_cash_price, @promo_card_price, @promo_start_time, @promo_end_time, @promo_days,
       @created_at, @updated_at)`).run(price)
  },
  bulkReplace(tenantId, pricesArr) {
    const replaceAll = db.transaction((items) => {
      db.prepare('DELETE FROM prices WHERE tenant_id = ?').run(tenantId)
      for (const p of items) prices.upsert(p)
    })
    replaceAll(pricesArr)
  }
}

// Settings
const settings = {
  get(tenantId, key) {
    const row = db.prepare('SELECT * FROM settings WHERE tenant_id = ? AND key = ?').get(tenantId, key)
    if (row && row.value) {
      try { row.parsedValue = JSON.parse(row.value) } catch { row.parsedValue = row.value }
    }
    return row
  },
  getAll(tenantId) {
    return db.prepare('SELECT * FROM settings WHERE tenant_id = ?').all(tenantId)
  },
  set(tenantId, key, value) {
    const id = generateId()
    const val = typeof value === 'string' ? value : JSON.stringify(value)
    return db.prepare('INSERT OR REPLACE INTO settings (id, tenant_id, key, value) VALUES (?, ?, ?, ?)').run(id, tenantId, key, val)
  },
  bulkReplace(tenantId, settingsArr) {
    const replaceAll = db.transaction((items) => {
      db.prepare('DELETE FROM settings WHERE tenant_id = ?').run(tenantId)
      for (const s of items) {
        const id = s._id || s.id || generateId()
        const val = typeof s.value === 'string' ? s.value : JSON.stringify(s.value)
        db.prepare('INSERT OR REPLACE INTO settings (id, tenant_id, key, value) VALUES (?, ?, ?, ?)').run(id, tenantId, s.key, val)
      }
    })
    replaceAll(settingsArr)
  }
}

// Interfaces
const interfaces = {
  getAll(tenantId) {
    return db.prepare('SELECT * FROM interfaces WHERE tenant_id = ?').all(tenantId)
  },
  getById(id) {
    return db.prepare('SELECT * FROM interfaces WHERE id = ?').get(id)
  },
  upsert(iface) {
    return db.prepare(`INSERT OR REPLACE INTO interfaces
      (id, tenant_id, name, brand, model, serial_number, address, ports, t_on, t_off, status, created_at, updated_at)
      VALUES (@id, @tenant_id, @name, @brand, @model, @serial_number, @address, @ports, @t_on, @t_off, @status, @created_at, @updated_at)`).run(iface)
  },
  bulkReplace(tenantId, ifacesArr) {
    const replaceAll = db.transaction((items) => {
      db.prepare('DELETE FROM interfaces WHERE tenant_id = ?').run(tenantId)
      for (const i of items) interfaces.upsert(i)
    })
    replaceAll(ifacesArr)
  }
}

// Peripherals
const peripherals = {
  getAll(tenantId) {
    return db.prepare('SELECT * FROM peripherals WHERE tenant_id = ?').all(tenantId)
  },
  getByType(tenantId, type) {
    return db.prepare('SELECT * FROM peripherals WHERE tenant_id = ? AND type = ? AND enabled = 1').get(tenantId, type)
  },
  upsert(p) {
    return db.prepare(`INSERT OR REPLACE INTO peripherals
      (id, tenant_id, name, type, enabled, protocol, address, baud_rate, brand, model, serial_number, status, image, hopper_config, created_at, updated_at)
      VALUES (@id, @tenant_id, @name, @type, @enabled, @protocol, @address, @baud_rate, @brand, @model, @serial_number, @status, @image, @hopper_config, @created_at, @updated_at)`).run(p)
  },
  bulkReplace(tenantId, periphArr) {
    const replaceAll = db.transaction((items) => {
      db.prepare('DELETE FROM peripherals WHERE tenant_id = ?').run(tenantId)
      for (const p of items) peripherals.upsert(p)
    })
    replaceAll(periphArr)
  }
}

// Sync outbound queue
const syncQueue = {
  push(entityType, entityId, action, payload, priority = 5) {
    return db.prepare(`INSERT INTO sync_outbound (entity_type, entity_id, action, payload, priority)
      VALUES (?, ?, ?, ?, ?)`).run(entityType, entityId, action, JSON.stringify(payload), priority)
  },
  getPending(limit = 50) {
    return db.prepare('SELECT * FROM sync_outbound WHERE status = ? ORDER BY priority ASC, created_at ASC LIMIT ?').all('pending', limit)
  },
  markSynced(id) {
    return db.prepare('UPDATE sync_outbound SET status = ?, last_attempt_at = datetime("now") WHERE id = ?').run('synced', id)
  },
  markFailed(id, error) {
    return db.prepare('UPDATE sync_outbound SET status = ?, error = ?, attempts = attempts + 1, last_attempt_at = datetime("now") WHERE id = ?').run('failed', error, id)
  },
  retry(id) {
    return db.prepare('UPDATE sync_outbound SET status = ? WHERE id = ?').run('pending', id)
  },
  retryAll() {
    return db.prepare('UPDATE sync_outbound SET status = ? WHERE status = ?').run('pending', 'failed')
  },
  countPending() {
    const row = db.prepare('SELECT COUNT(*) as count FROM sync_outbound WHERE status = ?').get('pending')
    return row ? row.count : 0
  }
}

// Sync metadata
const syncMeta = {
  get(entityType) {
    return db.prepare('SELECT * FROM sync_meta WHERE entity_type = ?').get(entityType)
  },
  set(entityType, data) {
    return db.prepare(`INSERT OR REPLACE INTO sync_meta (entity_type, last_synced_at, last_pushed_at, server_version)
      VALUES (?, ?, ?, ?)`).run(entityType, data.last_synced_at || null, data.last_pushed_at || null, data.server_version || null)
  }
}

// Session
const session = {
  getCurrent() {
    return db.prepare('SELECT * FROM sessions ORDER BY id DESC LIMIT 1').get()
  },
  create() {
    return db.prepare('INSERT INTO sessions DEFAULT VALUES').run()
  },
  update(id, data) {
    const fields = []
    const values = []
    for (const [k, v] of Object.entries(data)) {
      fields.push(`${k} = ?`)
      values.push(typeof v === 'object' ? JSON.stringify(v) : v)
    }
    fields.push('updated_at = datetime("now")')
    values.push(id)
    return db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },
  reset() {
    db.prepare('DELETE FROM sessions').run()
    return session.create()
  }
}

function getDb() { return db }
function closeDatabase() { if (db) { db.close(); db = null } }

module.exports = {
  initDatabase, getDb, closeDatabase, generateId,
  machines, cards, sales, prices, settings, interfaces, peripherals,
  syncQueue, syncMeta, session
}
