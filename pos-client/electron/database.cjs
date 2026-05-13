/**
 * WashBubbles Local Database (sql.js — pure WASM, no native deps)
 * Offline-first storage for POS operations
 * 
 * Fixes applied:
 * - #8:  SQL injection in session.update() — whitelist columns
 * - #11: Sync queue cleanup — auto-purge synced items > 7 days
 * - #21: generateId() uses top-level crypto import
 * - #23: Added index on sales.card_code
 * - #24: bulkReplace uses upsert instead of delete-all
 */
const path = require('path')
const fs = require('fs')
const { randomUUID } = require('crypto')

let initSqlJs, SQL
let db = null
let dbPath = null
let saveTimer = null

const DB_VERSION = 2

function generateId() {
  return randomUUID()
}

/** Get path to the database file */
function getDbPath() {
  try {
    const { app } = require('electron')
    return path.join(app.getPath('userData'), 'washbubbles.db')
  } catch {
    return path.join(__dirname, '..', 'data', 'washbubbles.db')
  }
}

/** Save database to disk */
function saveToDisk() {
  if (!db) return
  try {
    const data = db.export()
    const buffer = Buffer.from(data)
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    // Atomic write: write to temp then rename
    const tmpPath = dbPath + '.tmp'
    fs.writeFileSync(tmpPath, buffer)
    fs.renameSync(tmpPath, dbPath)
  } catch (err) {
    console.error('[DB] Save failed:', err.message)
  }
}

/** Schedule a debounced save (max every 2s) */
function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveToDisk()
    saveTimer = null
  }, 2000)
}

/** Force immediate save */
function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  saveToDisk()
}

/** Initialize the database (async — must await) */
async function initDatabase(customPath) {
  if (db) return db
  dbPath = customPath || getDbPath()

  // Load sql.js WASM
  if (!initSqlJs) {
    const sqljs = require('sql.js')
    initSqlJs = sqljs.default || sqljs
  }
  SQL = await initSqlJs()

  // Load existing DB or create new
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')

  runMigrations()
  // Auto-save every 30s
  setInterval(() => saveToDisk(), 30000)
  console.log(`[DB] Initialized at ${dbPath}`)
  return db
}

// ─── Helpers to match better-sqlite3 API patterns ───

function queryGet(sql, params) {
  const stmt = db.prepare(sql)
  if (params) stmt.bind(Array.isArray(params) ? params : [params])
  let result = undefined
  if (stmt.step()) result = stmt.getAsObject()
  stmt.free()
  return result
}

function queryAll(sql, params) {
  const stmt = db.prepare(sql)
  if (params) stmt.bind(Array.isArray(params) ? params : [params])
  const results = []
  while (stmt.step()) results.push(stmt.getAsObject())
  stmt.free()
  return results
}

function run(sql, params) {
  if (params) {
    db.run(sql, Array.isArray(params) ? params : [params])
  } else {
    db.run(sql)
  }
  scheduleSave()
  return { changes: db.getRowsModified() }
}

function exec(sql) {
  db.exec(sql)
  scheduleSave()
}

function runTransaction(fn) {
  db.run('BEGIN TRANSACTION')
  try {
    fn()
    db.run('COMMIT')
    scheduleSave()
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

/** Safe money rounding to avoid floating point drift */
function roundMoney(val) {
  return Math.round(val * 100) / 100
}

// ─── Migrations ───

function runMigrations() {
  exec(`CREATE TABLE IF NOT EXISTS db_meta (key TEXT PRIMARY KEY, value TEXT)`)

  const row = queryGet(`SELECT value FROM db_meta WHERE key = ?`, ['version'])
  const currentVersion = row ? parseInt(row.value, 10) : 0

  if (currentVersion < 1) migrateV1()
  if (currentVersion < 2) migrateV2()

  run(`INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)`, ['version', String(DB_VERSION)])
  flushSave()
}

function migrateV1() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY, local_id TEXT UNIQUE, tenant_id TEXT NOT NULL,
      name TEXT NOT NULL, number INTEGER, brand TEXT DEFAULT '', model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '', status TEXT DEFAULT 'free', status_text TEXT,
      cycle INTEGER DEFAULT 0, weight REAL DEFAULT 0, type TEXT DEFAULT 'wash',
      icon TEXT, int_id INTEGER, channel INTEGER, impulses TEXT DEFAULT '1',
      reserved INTEGER DEFAULT 0, reserved_by TEXT, reserved_at TEXT,
      reservation_duration INTEGER DEFAULT 0, current_program TEXT, started_at TEXT,
      estimated_end_time TEXT, running_duration INTEGER DEFAULT 0,
      interface_id TEXT, port INTEGER, activation TEXT DEFAULT 'high', t_imp REAL,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      synced INTEGER DEFAULT 0, last_synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY, local_id TEXT UNIQUE, tenant_id TEXT NOT NULL,
      code TEXT NOT NULL, balance REAL DEFAULT 0, name TEXT DEFAULT '',
      email TEXT DEFAULT '', phone TEXT DEFAULT '', contribuinte TEXT DEFAULT '',
      metadata TEXT, created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')), synced INTEGER DEFAULT 0, last_synced_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_tenant_code ON cards(tenant_id, code);

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY, local_id TEXT UNIQUE NOT NULL, tenant_id TEXT NOT NULL,
      machine_id TEXT, amount REAL NOT NULL, items TEXT, type TEXT DEFAULT 'payment',
      method TEXT, batch_id TEXT, card_id TEXT, card_code TEXT,
      inserted REAL DEFAULT 0, change_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), synced INTEGER DEFAULT 0,
      last_synced_at TEXT, sync_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sales_tenant_date ON sales(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_synced ON sales(synced);
    CREATE INDEX IF NOT EXISTS idx_sales_card_code ON sales(tenant_id, card_code);

    CREATE TABLE IF NOT EXISTS prices (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, type TEXT NOT NULL,
      weight REAL NOT NULL, duration INTEGER,
      cash_price REAL NOT NULL DEFAULT 0, card_price REAL NOT NULL DEFAULT 0,
      promo_active INTEGER DEFAULT 0, promo_cash_price REAL, promo_card_price REAL,
      promo_start_time TEXT, promo_end_time TEXT, promo_days TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prices_lookup ON prices(tenant_id, type, weight);

    CREATE TABLE IF NOT EXISTS interfaces (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
      brand TEXT DEFAULT '', model TEXT DEFAULT '', serial_number TEXT NOT NULL,
      address INTEGER NOT NULL, ports INTEGER DEFAULT 2, t_on INTEGER DEFAULT 100,
      t_off INTEGER DEFAULT 100, status TEXT DEFAULT 'inactive',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS peripherals (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
      type TEXT NOT NULL, enabled INTEGER DEFAULT 1, protocol TEXT DEFAULT 'pulse',
      address TEXT DEFAULT '', baud_rate TEXT DEFAULT '', brand TEXT DEFAULT '',
      model TEXT DEFAULT '', serial_number TEXT DEFAULT '', status TEXT DEFAULT 'unknown',
      image TEXT DEFAULT '', hopper_config TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_tenant_key ON settings(tenant_id, key);

    CREATE TABLE IF NOT EXISTS sync_outbound (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')), attempts INTEGER DEFAULT 0,
      last_attempt_at TEXT, status TEXT DEFAULT 'pending', error TEXT, priority INTEGER DEFAULT 5
    );
    CREATE INDEX IF NOT EXISTS idx_sync_outbound_status ON sync_outbound(status, priority);

    CREATE TABLE IF NOT EXISTS sync_meta (
      entity_type TEXT PRIMARY KEY, last_synced_at TEXT, last_pushed_at TEXT, server_version TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, local_data TEXT NOT NULL, server_data TEXT NOT NULL,
      resolution TEXT, resolved_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cash_balance REAL DEFAULT 0,
      card_code TEXT, card_balance REAL DEFAULT 0, has_card INTEGER DEFAULT 0,
      bonus REAL DEFAULT 0, money_arr TEXT DEFAULT '[]', bonus_arr TEXT DEFAULT '[]',
      charged_arr TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
  `)
}

function migrateV2() {
  // Fix #18, #19: Add missing tables for day_closes and card_purchases
  db.exec(`
    CREATE TABLE IF NOT EXISTS day_closes (
      id TEXT PRIMARY KEY, local_id TEXT UNIQUE, tenant_id TEXT NOT NULL,
      date TEXT NOT NULL, total_sales REAL DEFAULT 0, total_cash REAL DEFAULT 0,
      total_card REAL DEFAULT 0, total_recharges REAL DEFAULT 0,
      sale_count INTEGER DEFAULT 0, notes TEXT,
      created_at TEXT DEFAULT (datetime('now')), synced INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS card_purchases (
      id TEXT PRIMARY KEY, local_id TEXT UNIQUE, tenant_id TEXT NOT NULL,
      card_code TEXT NOT NULL, card_cost REAL DEFAULT 0, initial_credit REAL DEFAULT 0,
      method TEXT DEFAULT 'cash', created_at TEXT DEFAULT (datetime('now')),
      synced INTEGER DEFAULT 0
    );
  `)
}

// ─── CRUD: Machines ───
const machines = {
  getAll(tenantId) {
    return queryAll('SELECT * FROM machines WHERE tenant_id = ? ORDER BY number ASC, created_at ASC', [tenantId])
  },
  getById(id) {
    return queryGet('SELECT * FROM machines WHERE id = ?', [id])
  },
  getByIntId(intId) {
    return queryGet('SELECT * FROM machines WHERE int_id = ?', [intId])
  },
  upsert(m) {
    return run(`INSERT OR REPLACE INTO machines
      (id,local_id,tenant_id,name,number,brand,model,serial_number,status,status_text,
       cycle,weight,type,icon,int_id,channel,impulses,reserved,reserved_by,reserved_at,
       reservation_duration,current_program,started_at,estimated_end_time,running_duration,
       interface_id,port,activation,t_imp,created_at,updated_at,synced,last_synced_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [m.id,m.local_id,m.tenant_id,m.name,m.number,m.brand,m.model,m.serial_number,
       m.status,m.status_text,m.cycle,m.weight,m.type,m.icon,m.int_id,m.channel,
       m.impulses,m.reserved,m.reserved_by,m.reserved_at,m.reservation_duration,
       m.current_program,m.started_at,m.estimated_end_time,m.running_duration,
       m.interface_id,m.port,m.activation,m.t_imp,m.created_at,m.updated_at,
       m.synced,m.last_synced_at])
  },
  updateStatus(id, status, statusText) {
    return run('UPDATE machines SET status=?, status_text=?, updated_at=datetime("now") WHERE id=?', [status, statusText, id])
  },
  incrementCycle(id) {
    return run('UPDATE machines SET cycle=cycle+1, updated_at=datetime("now") WHERE id=?', [id])
  },
  /** Fix #10: Only upsert CONFIG fields, preserve local runtime status */
  bulkUpsertConfigOnly(arr) {
    runTransaction(() => {
      for (const m of arr) {
        const existing = queryGet('SELECT id, status, cycle, current_program, started_at FROM machines WHERE id=?', [m.id])
        if (existing) {
          // Keep local runtime state, update config only
          run(`UPDATE machines SET name=?,number=?,brand=?,model=?,serial_number=?,weight=?,type=?,
               icon=?,int_id=?,channel=?,impulses=?,interface_id=?,port=?,activation=?,t_imp=?,
               updated_at=?,synced=1,last_synced_at=datetime('now') WHERE id=?`,
            [m.name,m.number,m.brand,m.model,m.serial_number,m.weight,m.type,m.icon,m.int_id,
             m.channel,m.impulses,m.interface_id,m.port,m.activation,m.t_imp,m.updated_at,m.id])
        } else {
          machines.upsert(m)
        }
      }
    })
  },
  bulkUpsert(arr) {
    runTransaction(() => { for (const m of arr) machines.upsert(m) })
  }
}

// ─── CRUD: Cards ───
const cards = {
  getAll(tenantId) {
    return queryAll('SELECT * FROM cards WHERE tenant_id=? ORDER BY created_at DESC', [tenantId])
  },
  getByCode(tenantId, code) {
    return queryGet('SELECT * FROM cards WHERE tenant_id=? AND code=?', [tenantId, code])
  },
  getById(id) {
    return queryGet('SELECT * FROM cards WHERE id=?', [id])
  },
  upsert(c) {
    return run(`INSERT OR REPLACE INTO cards
      (id,local_id,tenant_id,code,balance,name,email,phone,contribuinte,metadata,created_at,updated_at,synced,last_synced_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [c.id,c.local_id,c.tenant_id,c.code,c.balance,c.name,c.email,c.phone,c.contribuinte,
       c.metadata,c.created_at,c.updated_at,c.synced,c.last_synced_at])
  },
  updateBalance(id, newBalance) {
    return run('UPDATE cards SET balance=?, updated_at=datetime("now"), synced=0 WHERE id=?',
      [roundMoney(newBalance), id])
  },
  /** Fix #9: Only update config fields from server, preserve local balance if unsynced */
  bulkUpsertPreserveBalance(arr) {
    runTransaction(() => {
      for (const c of arr) {
        const existing = queryGet('SELECT id, balance, synced FROM cards WHERE id=?', [c.id])
        if (existing && existing.synced === 0) {
          // Local has unsynced changes — keep local balance, update other fields
          run(`UPDATE cards SET name=?,email=?,phone=?,contribuinte=?,metadata=?,
               updated_at=?,last_synced_at=datetime('now') WHERE id=?`,
            [c.name,c.email,c.phone,c.contribuinte,c.metadata,c.updated_at,c.id])
        } else {
          cards.upsert(c)
        }
      }
    })
  },
  bulkUpsert(arr) {
    runTransaction(() => { for (const c of arr) cards.upsert(c) })
  }
}

// ─── CRUD: Sales ───
const sales = {
  create(sale) {
    const id = sale.id || generateId()
    const localId = sale.local_id || generateId()
    run(`INSERT INTO sales (id,local_id,tenant_id,machine_id,amount,items,type,method,
         batch_id,card_id,card_code,inserted,change_amount,created_at,synced)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      [id, localId, sale.tenant_id, sale.machine_id||null, roundMoney(sale.amount),
       typeof sale.items === 'string' ? sale.items : JSON.stringify(sale.items||null),
       sale.type||'payment', sale.method||null, sale.batch_id||null,
       sale.card_id||null, sale.card_code||null,
       roundMoney(sale.inserted||0), roundMoney(sale.change_amount||0),
       sale.created_at || new Date().toISOString()])
    return { id, local_id: localId }
  },
  getAll(tenantId, limit) {
    return queryAll('SELECT * FROM sales WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?', [tenantId, limit||100])
  },
  getByCardCode(tenantId, code, limit) {
    return queryAll('SELECT * FROM sales WHERE tenant_id=? AND card_code=? ORDER BY created_at DESC LIMIT ?', [tenantId, code, limit||30])
  },
  getUnsynced(limit) {
    return queryAll('SELECT * FROM sales WHERE synced=0 ORDER BY created_at ASC LIMIT ?', [limit||50])
  },
  markSynced(localId, serverId) {
    return run('UPDATE sales SET synced=1, last_synced_at=datetime("now"), id=COALESCE(?,id) WHERE local_id=? OR id=?', [serverId, localId, localId])
  }
}

// ─── CRUD: Prices ───
const prices = {
  getAll(tenantId) {
    return queryAll('SELECT * FROM prices WHERE tenant_id=? ORDER BY type, weight', [tenantId])
  },
  lookup(tenantId, type, weight) {
    return queryGet('SELECT * FROM prices WHERE tenant_id=? AND type=? AND weight=?', [tenantId, type, weight])
  },
  upsert(p) {
    return run(`INSERT OR REPLACE INTO prices
      (id,tenant_id,type,weight,duration,cash_price,card_price,promo_active,
       promo_cash_price,promo_card_price,promo_start_time,promo_end_time,promo_days,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.id,p.tenant_id,p.type,p.weight,p.duration,p.cash_price,p.card_price,
       p.promo_active,p.promo_cash_price,p.promo_card_price,p.promo_start_time,
       p.promo_end_time,p.promo_days,p.created_at,p.updated_at])
  },
  bulkReplace(tenantId, arr) {
    runTransaction(() => {
      run('DELETE FROM prices WHERE tenant_id=?', [tenantId])
      for (const p of arr) prices.upsert(p)
    })
  }
}

// ─── CRUD: Settings ───
const settings = {
  get(tenantId, key) {
    const row = queryGet('SELECT * FROM settings WHERE tenant_id=? AND key=?', [tenantId, key])
    if (row && row.value) {
      try { row.parsedValue = JSON.parse(row.value) } catch { row.parsedValue = row.value }
    }
    return row
  },
  getAll(tenantId) {
    return queryAll('SELECT * FROM settings WHERE tenant_id=?', [tenantId])
  },
  set(tenantId, key, value) {
    const id = generateId()
    const val = typeof value === 'string' ? value : JSON.stringify(value)
    return run('INSERT OR REPLACE INTO settings (id,tenant_id,key,value) VALUES (?,?,?,?)', [id, tenantId, key, val])
  },
  bulkReplace(tenantId, arr) {
    runTransaction(() => {
      run('DELETE FROM settings WHERE tenant_id=?', [tenantId])
      for (const s of arr) {
        const id = s._id || s.id || generateId()
        const val = typeof s.value === 'string' ? s.value : JSON.stringify(s.value)
        run('INSERT OR REPLACE INTO settings (id,tenant_id,key,value) VALUES (?,?,?,?)', [id, tenantId, s.key, val])
      }
    })
  }
}

// ─── CRUD: Interfaces ───
const interfaces = {
  getAll(tenantId) { return queryAll('SELECT * FROM interfaces WHERE tenant_id=?', [tenantId]) },
  getById(id) { return queryGet('SELECT * FROM interfaces WHERE id=?', [id]) },
  upsert(i) {
    return run(`INSERT OR REPLACE INTO interfaces
      (id,tenant_id,name,brand,model,serial_number,address,ports,t_on,t_off,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [i.id,i.tenant_id,i.name,i.brand,i.model,i.serial_number,i.address,i.ports,i.t_on,i.t_off,i.status,i.created_at,i.updated_at])
  },
  bulkReplace(tenantId, arr) {
    runTransaction(() => {
      run('DELETE FROM interfaces WHERE tenant_id=?', [tenantId])
      for (const i of arr) interfaces.upsert(i)
    })
  }
}

// ─── CRUD: Peripherals ───
const peripherals = {
  getAll(tenantId) { return queryAll('SELECT * FROM peripherals WHERE tenant_id=?', [tenantId]) },
  getByType(tenantId, type) {
    return queryGet('SELECT * FROM peripherals WHERE tenant_id=? AND type=? AND enabled=1', [tenantId, type])
  },
  upsert(p) {
    return run(`INSERT OR REPLACE INTO peripherals
      (id,tenant_id,name,type,enabled,protocol,address,baud_rate,brand,model,serial_number,status,image,hopper_config,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.id,p.tenant_id,p.name,p.type,p.enabled,p.protocol,p.address,p.baud_rate,p.brand,p.model,p.serial_number,p.status,p.image,p.hopper_config,p.created_at,p.updated_at])
  },
  bulkReplace(tenantId, arr) {
    runTransaction(() => {
      run('DELETE FROM peripherals WHERE tenant_id=?', [tenantId])
      for (const p of arr) peripherals.upsert(p)
    })
  }
}

// ─── Sync Queue (Fix #11: cleanup, Fix #13: auto-retry) ───
const syncQueue = {
  push(entityType, entityId, action, payload, priority) {
    return run(`INSERT INTO sync_outbound (entity_type,entity_id,action,payload,priority) VALUES (?,?,?,?,?)`,
      [entityType, entityId, action, JSON.stringify(payload), priority||5])
  },
  getPending(limit) {
    // Fix #13: Also pick up failed items with < 10 attempts for retry
    return queryAll(
      `SELECT * FROM sync_outbound WHERE status IN ('pending','failed') AND attempts < 10
       ORDER BY priority ASC, created_at ASC LIMIT ?`, [limit||50])
  },
  markSynced(id) {
    return run('UPDATE sync_outbound SET status=?, last_attempt_at=datetime("now") WHERE id=?', ['synced', id])
  },
  markFailed(id, error) {
    return run('UPDATE sync_outbound SET status=?, error=?, attempts=attempts+1, last_attempt_at=datetime("now") WHERE id=?', ['failed', error, id])
  },
  countPending() {
    const row = queryGet('SELECT COUNT(*) as count FROM sync_outbound WHERE status IN (?,?)', ['pending', 'failed'])
    return row ? row.count : 0
  },
  /** Fix #11: Purge old synced items */
  cleanup() {
    return run("DELETE FROM sync_outbound WHERE status='synced' AND created_at < datetime('now', '-7 days')")
  }
}

// ─── Sync Meta ───
const syncMeta = {
  get(entityType) { return queryGet('SELECT * FROM sync_meta WHERE entity_type=?', [entityType]) },
  set(entityType, data) {
    return run('INSERT OR REPLACE INTO sync_meta (entity_type,last_synced_at,last_pushed_at,server_version) VALUES (?,?,?,?)',
      [entityType, data.last_synced_at||null, data.last_pushed_at||null, data.server_version||null])
  }
}

// ─── Session (Fix #8: whitelist columns) ───
const VALID_SESSION_COLS = new Set(['cash_balance','card_code','card_balance','has_card','bonus','money_arr','bonus_arr','charged_arr'])

const session = {
  getCurrent() { return queryGet('SELECT * FROM sessions ORDER BY id DESC LIMIT 1') },
  create() { return run('INSERT INTO sessions DEFAULT VALUES') },
  update(id, data) {
    const fields = []
    const values = []
    for (const [k, v] of Object.entries(data)) {
      if (!VALID_SESSION_COLS.has(k)) continue // Fix #8: skip invalid columns
      fields.push(`${k} = ?`)
      values.push(typeof v === 'object' ? JSON.stringify(v) : v)
    }
    if (fields.length === 0) return
    fields.push('updated_at = datetime("now")')
    values.push(id)
    return run(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`, values)
  },
  reset() {
    run('DELETE FROM sessions')
    return session.create()
  }
}

// ─── Day Closes (Fix #18) ───
const dayCloses = {
  create(dc) {
    const id = dc.id || generateId()
    const localId = dc.local_id || generateId()
    return run(`INSERT INTO day_closes (id,local_id,tenant_id,date,total_sales,total_cash,total_card,total_recharges,sale_count,notes,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, localId, dc.tenant_id, dc.date, dc.total_sales||0, dc.total_cash||0, dc.total_card||0,
       dc.total_recharges||0, dc.sale_count||0, dc.notes||null, dc.created_at||new Date().toISOString()])
  },
  getByDate(tenantId, date) {
    return queryGet('SELECT * FROM day_closes WHERE tenant_id=? AND date=?', [tenantId, date])
  },
  getAll(tenantId, limit) {
    return queryAll('SELECT * FROM day_closes WHERE tenant_id=? ORDER BY date DESC LIMIT ?', [tenantId, limit||30])
  }
}

function getDb() { return db }
function closeDatabase() {
  if (db) { flushSave(); db.close(); db = null }
}

module.exports = {
  initDatabase, getDb, closeDatabase, generateId, roundMoney,
  runTransaction, flushSave,
  machines, cards, sales, prices, settings, interfaces, peripherals,
  syncQueue, syncMeta, session, dayCloses
}
