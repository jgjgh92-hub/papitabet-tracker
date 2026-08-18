require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'papitabet.db');
const db = new sqlite3.Database(DB_PATH);

// Helper promises
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes });
  });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows || []); });
});

// Inicialización de tablas
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_msg_id INTEGER UNIQUE,
      image_path TEXT,
      image_url TEXT,
      game TEXT DEFAULT 'Unknown',
      team1 TEXT,
      team2 TEXT,
      bet_type TEXT,
      pick TEXT,
      odds REAL,
      stake REAL,
      potential_win REAL,
      profit_loss REAL,
      bet_date TEXT,
      match_date TEXT,
      platform TEXT,
      tournament TEXT,
      status TEXT DEFAULT 'pending',
      verified INTEGER DEFAULT 0,
      verified_at TEXT,
      verification_source TEXT,
      notes TEXT,
      raw_gemini_response TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bankroll (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      initial_capital REAL DEFAULT 0,
      current_capital REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      synced_at TEXT DEFAULT (datetime('now')),
      messages_found INTEGER DEFAULT 0,
      bets_processed INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ok',
      error TEXT
    )
  `);

  db.get('SELECT id FROM bankroll WHERE id = 1', (err, row) => {
    if (!row) {
      db.run('INSERT INTO bankroll (id, initial_capital, current_capital) VALUES (1, 0, 0)');
    }
  });
});

const queries = {
  getBets: async (filters = {}) => {
    let sql = 'SELECT * FROM bets WHERE 1=1';
    const params = [];
    if (filters.game) { sql += ' AND game = ?'; params.push(filters.game); }
    if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters.dateFrom) { sql += ' AND bet_date >= ?'; params.push(filters.dateFrom); }
    if (filters.dateTo) { sql += ' AND bet_date <= ?'; params.push(filters.dateTo); }
    if (filters.search) {
      sql += ' AND (team1 LIKE ? OR team2 LIKE ? OR tournament LIKE ?)';
      const s = `%${filters.search}%`;
      params.push(s, s, s);
    }
    sql += ' ORDER BY created_at DESC';
    if (filters.limit) { sql += ` LIMIT ${parseInt(filters.limit)}`; }
    return await dbAll(sql, params);
  },

  getBetById: async (id) => await dbGet('SELECT * FROM bets WHERE id = ?', [id]),

  insertBet: async (bet) => {
    const sql = `
      INSERT OR IGNORE INTO bets 
        (telegram_msg_id, image_path, image_url, game, team1, team2, bet_type, pick, odds, stake, 
         potential_win, bet_date, match_date, platform, tournament, status, raw_gemini_response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      bet.telegram_msg_id || null, bet.image_path || null, bet.image_url || null, bet.game || 'Unknown',
      bet.team1 || null, bet.team2 || null, bet.bet_type || null, bet.pick || null, bet.odds || null,
      bet.stake || null, bet.potential_win || null, bet.bet_date || null, bet.match_date || null,
      bet.platform || null, bet.tournament || null, bet.status || 'pending', bet.raw_gemini_response || null
    ];
    const res = await dbRun(sql, params);
    return res.lastID;
  },

  updateBet: async (id, data) => {
    const keys = Object.keys(data);
    if (!keys.length) return;
    const fields = keys.map(k => `${k} = ?`).join(', ');
    const sql = `UPDATE bets SET ${fields}, updated_at = datetime('now') WHERE id = ?`;
    const params = [...Object.values(data), id];
    return await dbRun(sql, params);
  },

  deleteBet: async (id) => await dbRun('DELETE FROM bets WHERE id = ?', [id]),

  getPendingBets: async () => await dbAll("SELECT * FROM bets WHERE status = 'pending' ORDER BY bet_date DESC"),

  getStats: async () => {
    const totalRow = await dbGet('SELECT COUNT(*) as count FROM bets');
    const wonRow = await dbGet("SELECT COUNT(*) as count FROM bets WHERE status = 'won'");
    const lostRow = await dbGet("SELECT COUNT(*) as count FROM bets WHERE status = 'lost'");
    const pendingRow = await dbGet("SELECT COUNT(*) as count FROM bets WHERE status = 'pending'");
    const voidRow = await dbGet("SELECT COUNT(*) as count FROM bets WHERE status = 'void'");

    const total = totalRow ? totalRow.count : 0;
    const won = wonRow ? wonRow.count : 0;
    const lost = lostRow ? lostRow.count : 0;
    const pending = pendingRow ? pendingRow.count : 0;
    const void_ = voidRow ? voidRow.count : 0;

    const stakeData = await dbGet("SELECT SUM(stake) as total FROM bets WHERE status IN ('won','lost')");
    const wonProfit = await dbGet("SELECT SUM(potential_win - stake) as profit FROM bets WHERE status = 'won'");
    const lostProfit = await dbGet("SELECT SUM(stake) as loss FROM bets WHERE status = 'lost'");

    const totalStake = stakeData?.total || 0;
    const totalProfit = (wonProfit?.profit || 0) - (lostProfit?.loss || 0);
    const roi = totalStake > 0 ? ((totalProfit / totalStake) * 100).toFixed(2) : 0;
    const winRate = (won + lost) > 0 ? ((won / (won + lost)) * 100).toFixed(1) : 0;

    const byGame = await dbAll(`
      SELECT game, 
        COUNT(*) as total,
        SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) as won,
        SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END) as lost,
        SUM(CASE WHEN status='won' THEN potential_win - stake ELSE -stake END) as profit
      FROM bets WHERE status IN ('won','lost')
      GROUP BY game
    `);

    const byMarket = await dbAll(`
      SELECT bet_type,
        COUNT(*) as total,
        SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) as won,
        SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END) as lost
      FROM bets WHERE status IN ('won','lost') AND bet_type IS NOT NULL
      GROUP BY bet_type
    `);

    const dailyProfit = await dbAll(`
      SELECT bet_date as date,
        SUM(CASE WHEN status='won' THEN potential_win - stake WHEN status='lost' THEN -stake ELSE 0 END) as daily_profit
      FROM bets WHERE status IN ('won','lost') AND bet_date IS NOT NULL
      GROUP BY bet_date ORDER BY bet_date ASC
    `);

    let cumulative = 0;
    const cumulativeProfit = dailyProfit.map(d => {
      cumulative += d.daily_profit;
      return { date: d.date, profit: parseFloat(cumulative.toFixed(2)) };
    });

    const last20 = await dbAll("SELECT status FROM bets WHERE status IN ('won','lost') ORDER BY created_at DESC LIMIT 20");
    let streak = 0;
    let streakType = null;
    for (const b of last20) {
      if (!streakType) streakType = b.status;
      if (b.status === streakType) streak++;
      else break;
    }

    return {
      total, won, lost, pending, void: void_,
      totalStake: parseFloat(totalStake.toFixed(2)),
      totalProfit: parseFloat(totalProfit.toFixed(2)),
      roi: parseFloat(roi),
      winRate: parseFloat(winRate),
      byGame, byMarket, cumulativeProfit,
      streak: { count: streak, type: streakType }
    };
  },

  getBankroll: async () => await dbGet('SELECT * FROM bankroll WHERE id = 1'),
  updateBankroll: async (data) => await dbRun('UPDATE bankroll SET initial_capital=?, current_capital=?, updated_at=datetime("now") WHERE id=1', [data.initial_capital, data.current_capital]),

  logSync: async (data) => await dbRun('INSERT INTO sync_log (messages_found, bets_processed, status, error) VALUES (?, ?, ?, ?)', [data.messages_found, data.bets_processed, data.status, data.error]),
  getLastSync: async () => await dbGet('SELECT * FROM sync_log ORDER BY synced_at DESC LIMIT 1'),
};

module.exports = { db, queries };
