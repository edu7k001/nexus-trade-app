const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;

// ========== CONEXÃO POSTGRESQL ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erro ao conectar ao PostgreSQL:', err);
  } else {
    console.log('✅ Conectado ao PostgreSQL');
    release();
  }
});

// ========== CRIAÇÃO DAS TABELAS ==========
async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        pix_key TEXT,
        cpf TEXT,
        phone TEXT,
        balance REAL DEFAULT 0,
        status TEXT DEFAULT 'Pendente',
        total_deposits REAL DEFAULT 0,
        total_withdraws REAL DEFAULT 0,
        total_bets REAL DEFAULT 0,
        total_wins REAL DEFAULT 0,
        rtp_individual REAL DEFAULT NULL,
        affiliate_code TEXT UNIQUE,
        referred_by INTEGER,
        affiliate_balance REAL DEFAULT 0,
        affiliate_commission REAL DEFAULT 10,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS affiliate_commissions (
        id SERIAL PRIMARY KEY,
        affiliate_id INTEGER,
        referred_id INTEGER,
        amount REAL,
        type TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        game TEXT,
        bet_amount REAL,
        result TEXT,
        win_amount REAL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS deposits (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        amount REAL,
        status TEXT DEFAULT 'Pendente',
        confirmed_by INTEGER,
        confirmed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS withdraw_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        name TEXT,
        cpf TEXT,
        pix_key TEXT,
        amount REAL,
        status TEXT DEFAULT 'Pendente',
        processed_by INTEGER,
        processed_at TIMESTAMP,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        type TEXT,
        amount REAL,
        balance_before REAL,
        balance_after REAL,
        reference_id INTEGER,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS house_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        total_bets REAL DEFAULT 0,
        total_paid REAL DEFAULT 0,
        total_users INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        pix_key TEXT,
        min_deposit REAL DEFAULT 20,
        bonus_amount REAL DEFAULT 30,
        min_withdraw REAL DEFAULT 150,
        max_withdraw REAL DEFAULT 5000,
        withdraw_fee REAL DEFAULT 0,
        slot_min_bet REAL DEFAULT 5,
        dice_min_bet REAL DEFAULT 5,
        crash_min_bet REAL DEFAULT 5,
        roulette_min_bet REAL DEFAULT 5,
        blackjack_min_bet REAL DEFAULT 5,
        slot_rtp REAL DEFAULT 95,
        dice_rtp REAL DEFAULT 95,
        crash_rtp REAL DEFAULT 95,
        roulette_rtp REAL DEFAULT 95,
        blackjack_rtp REAL DEFAULT 95,
        slot_volatility TEXT DEFAULT 'medium',
        dice_volatility TEXT DEFAULT 'medium',
        crash_volatility TEXT DEFAULT 'medium',
        site_name TEXT DEFAULT 'Nexus Trade',
        contact_email TEXT DEFAULT 'suporte@nexustrade.com',
        logo_path TEXT DEFAULT '/images/logo.png',
        primary_color TEXT DEFAULT '#f5b342',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Configuração inicial admin_config
    const config = await pool.query('SELECT * FROM admin_config WHERE id = 1');
    if (config.rows.length === 0) {
      await pool.query(`
        INSERT INTO admin_config (id, pix_key, min_deposit, bonus_amount, min_withdraw)
        VALUES (1, '1c5c21fc-fcbc-4b28-b285-74156c727917', 20, 30, 150)
      `);
    }

    // house_stats inicial
    await pool.query(`
      INSERT INTO house_stats (id, total_bets, total_paid)
      VALUES (1, 0, 0)
      ON CONFLICT (id) DO NOTHING
    `);

    // Admin padrão
    const adminPass = bcrypt.hashSync('admin123', 10);
    const admin = await pool.query('SELECT * FROM users WHERE email = $1', ['admin@nexus.com']);
    if (admin.rows.length === 0) {
      await pool.query(`
        INSERT INTO users (name, email, password, status)
        VALUES ('Administrador', 'admin@nexus.com', $1, 'Admin')
      `, [adminPass]);
    }

    console.log('✅ Tabelas criadas/verificadas');
  } catch (err) {
    console.error('❌ Erro ao criar tabelas:', err);
  }
}
createTables();

// ========== WEBSOCKET ==========
const clients = new Map();

wss.on('connection', (ws, req) => {
  console.log('✅ Novo cliente conectado');
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'auth' && data.userId) {
        clients.set(data.userId.toString(), ws);
        console.log(`👤 Usuário ${data.userId} autenticado`);
      }
    } catch (error) {
      console.error('Erro no WebSocket:', error);
    }
  });
  ws.on('close', () => {
    for (let [userId, client] of clients.entries()) {
      if (client === ws) {
        clients.delete(userId);
        console.log(`👤 Usuário ${userId} desconectado`);
        break;
      }
    }
  });
});

function sendRealTimeUpdate(userId, type, data) {
  const client = clients.get(userId.toString());
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({ type, data }));
  }
}

function sendToAllAdmins(type, data) {
  for (let [userId, client] of clients.entries()) {
    if (userId.toString().startsWith('admin')) {
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type, data }));
      }
    }
  }
}

// ========== MIDDLEWARES ==========
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ========== ROTAS PÚBLICAS (HTML) ==========
app.get('/cadastro', (req, res) => res.sendFile(path.join(__dirname, '../frontend/cadastro.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../frontend/login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../frontend/dashboard.html')));
app.get('/slot', (req, res) => res.sendFile(path.join(__dirname, '../frontend/slot.html')));
app.get('/dice', (req, res) => res.sendFile(path.join(__dirname, '../frontend/dice.html')));
app.get('/crash', (req, res) => res.sendFile(path.join(__dirname, '../frontend/crash.html')));
app.get('/roulette', (req, res) => res.sendFile(path.join(__dirname, '../frontend/roulette.html')));
app.get('/blackjack', (req, res) => res.sendFile(path.join(__dirname, '../frontend/blackjack.html')));
app.get('/affiliates', (req, res) => res.sendFile(path.join(__dirname, '../frontend/affiliates.html')));
app.get('/admin-login', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin-login.html')));

// ========== QR CODE ==========
app.get('/api/pix-qrcode', async (req, res) => {
  const imagePath = path.join(__dirname, '../frontend/images/pix-nexus.png');
  if (fs.existsSync(imagePath)) {
    try {
      const result = await pool.query('SELECT pix_key FROM admin_config WHERE id = 1');
      if (result.rows.length === 0) return res.status(500).json({ error: 'Erro ao buscar chave PIX' });
      res.json({ success: true, qrcode: '/images/pix-nexus.png', pixKey: result.rows[0].pix_key });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao buscar chave PIX' });
    }
  } else {
    res.status(404).json({ error: 'Imagem do QR Code não encontrada' });
  }
});

// ========== REGISTRO ==========
app.post('/api/register', async (req, res) => {
  const { name, email, password, pixKey, cpf, phone, ref } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const affiliateCode = 'NEX' + Math.random().toString(36).substring(2, 10).toUpperCase();
    let referredBy = null;
    if (ref) {
      const userRef = await pool.query('SELECT id FROM users WHERE affiliate_code = $1', [ref]);
      if (userRef.rows.length > 0) referredBy = userRef.rows[0].id;
    }
    const result = await pool.query(
      `INSERT INTO users (name, email, password, pix_key, cpf, phone, affiliate_code, referred_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [name, email, hashedPassword, pixKey || '', cpf || '', phone || '', affiliateCode, referredBy]
    );
    await pool.query('UPDATE house_stats SET total_users = total_users + 1 WHERE id = 1');
    res.status(201).json({ id: result.rows[0].id, message: 'Cadastro realizado!' });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }
    console.error(error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ========== LOGIN ==========
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Email ou senha inválidos' });
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Email ou senha inválidos' });
    await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
    delete user.password;
    res.json({ user, redirect: user.status === 'Admin' ? '/admin' : '/dashboard' });
  } catch (err) {
    res.status(500).json({ error: 'Erro no login' });
  }
});

// ========== ADMIN LOGIN ==========
app.post('/api/admin-login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
    if (user.status !== 'Admin') return res.status(403).json({ error: 'Acesso negado' });
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Credenciais inválidas' });
    await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
    delete user.password;
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Erro no login' });
  }
});

// ========== DEPÓSITO ==========
app.post('/api/request-deposit', async (req, res) => {
  const { userId, amount } = req.body;
  try {
    const userResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    const deposit = await pool.query(
      'INSERT INTO deposits (user_id, amount) VALUES ($1, $2) RETURNING id',
      [userId, amount]
    );
    sendToAllAdmins('new_deposit', { id: deposit.rows[0].id, user, amount });
    res.json({ message: '✅ Depósito solicitado!', depositId: deposit.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao solicitar depósito' });
  }
});

// ========== SAQUE ==========
app.post('/api/request-withdraw', async (req, res) => {
  const { userId, amount, name, cpf, pixKey } = req.body;
  try {
    const userResult = await pool.query('SELECT balance, name, email FROM users WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (user.balance < amount) return res.status(400).json({ error: 'Saldo insuficiente' });
    const config = await pool.query('SELECT min_withdraw FROM admin_config WHERE id = 1');
    const minWithdraw = config.rows[0].min_withdraw;
    if (amount < minWithdraw) return res.status(400).json({ error: `Saque mínimo: R$ ${minWithdraw}` });
    const withdraw = await pool.query(
      `INSERT INTO withdraw_requests (user_id, name, cpf, pix_key, amount)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, name || user.name, cpf, pixKey, amount]
    );
    sendToAllAdmins('new_withdraw', { id: withdraw.rows[0].id, user, amount });
    res.json({ message: '✅ Saque solicitado!', withdrawId: withdraw.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao solicitar saque' });
  }
});

// ========== FUNÇÃO AUXILIAR COMISSÃO AFILIADO ==========
async function processarComissaoAfiliado(userId, amount, type) {
  const user = await pool.query('SELECT referred_by FROM users WHERE id = $1', [userId]);
  if (!user.rows[0]?.referred_by) return;
  const affiliateId = user.rows[0].referred_by;
  const aff = await pool.query('SELECT affiliate_commission FROM users WHERE id = $1', [affiliateId]);
  if (!aff.rows[0]) return;
  const commission = (amount * aff.rows[0].affiliate_commission) / 100;
  await pool.query('UPDATE users SET affiliate_balance = affiliate_balance + $1 WHERE id = $2', [commission, affiliateId]);
  await pool.query(
    'INSERT INTO affiliate_commissions (affiliate_id, referred_id, amount, type) VALUES ($1, $2, $3, $4)',
    [affiliateId, userId, commission, type]
  );
  sendRealTimeUpdate(affiliateId, 'affiliate_commission', { amount: commission, type });
}

// ========== JOGO SLOT ==========
app.post('/api/game/slot', async (req, res) => {
  const { userId, betAmount } = req.body;
  try {
    const userData = await pool.query(`
      SELECT u.balance, u.status, u.rtp_individual,
             c.slot_rtp as global_rtp, c.slot_min_bet
      FROM users u CROSS JOIN admin_config c WHERE u.id = $1
    `, [userId]);
    const data = userData.rows[0];
    if (!data) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (betAmount < data.slot_min_bet) return res.status(400).json({ error: `Aposta mínima: R$ ${data.slot_min_bet}` });
    if (data.status === 'Pendente') return res.status(400).json({ error: 'Ative sua conta com um depósito' });
    if (data.balance < betAmount) return res.status(400).json({ error: 'Saldo insuficiente' });

    const rtpToUse = data.rtp_individual || data.global_rtp;
    const winChance = rtpToUse / 100;
    const symbols = ['🍒', '💎', '7️⃣', '⭐'];
    const multipliers = [2, 5, 10, 20];
    let r1, r2, r3, winAmount = 0, message = '';

    if (Math.random() < winChance) {
      if (Math.random() < 0.3) {
        const idx = Math.floor(Math.random() * symbols.length);
        r1 = r2 = r3 = idx;
        winAmount = betAmount * multipliers[idx];
        message = `🎉 GRANDE VITÓRIA! +R$ ${winAmount.toFixed(2)}`;
      } else {
        const idx = Math.floor(Math.random() * symbols.length);
        r1 = r2 = idx;
        r3 = (idx + 1) % symbols.length;
        winAmount = betAmount * 0.5;
        message = `👍 PEQUENA VITÓRIA! +R$ ${winAmount.toFixed(2)}`;
      }
    } else {
      r1 = 0; r2 = 1; r3 = 2;
      winAmount = 0;
      message = `😢 PERDEU! -R$ ${betAmount.toFixed(2)}`;
    }

    const newBalance = data.balance - betAmount + winAmount;
    await pool.query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, userId]);
    await pool.query(
      'INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES ($1, $2, $3, $4, $5)',
      [userId, 'slot', betAmount, message, winAmount]
    );

    if (winAmount === 0) await processarComissaoAfiliado(userId, betAmount, 'bet_loss');

    sendRealTimeUpdate(userId, 'balance_update', { balance: newBalance });
    res.json({
      success: true,
      symbols: [symbols[r1], symbols[r2], symbols[r3]],
      win: winAmount,
      newBalance,
      message
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no jogo' });
  }
});

// ========== JOGO DADOS ==========
app.post('/api/game/dice', async (req, res) => {
  const { userId, betAmount, betType } = req.body;
  try {
    const userData = await pool.query(`
      SELECT u.balance, u.status, c.dice_min_bet
      FROM users u CROSS JOIN admin_config c WHERE u.id = $1
    `, [userId]);
    const data = userData.rows[0];
    if (!data) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (betAmount < data.dice_min_bet) return res.status(400).json({ error: `Aposta mínima: R$ ${data.dice_min_bet}` });
    if (data.balance < betAmount) return res.status(400).json({ error: 'Saldo insuficiente' });

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const sum = d1 + d2;
    let winAmount = 0, message = '';

    if (betType.type === 'sum' && sum === betType.value) {
      winAmount = betAmount * 5;
      message = `🎉 SOMA ${sum}! +R$ ${winAmount.toFixed(2)}`;
    } else if (betType.type === 'double' && d1 === d2) {
      winAmount = betAmount * 8;
      message = `🎉 DUPLA DE ${d1}! +R$ ${winAmount.toFixed(2)}`;
    } else if (betType.type === 'specific' && (d1 === betType.value || d2 === betType.value)) {
      winAmount = betAmount * 6;
      message = `🎉 SAIU ${betType.value}! +R$ ${winAmount.toFixed(2)}`;
    } else {
      message = `😢 PERDEU! Soma: ${sum} -R$ ${betAmount.toFixed(2)}`;
    }

    const newBalance = data.balance - betAmount + winAmount;
    await pool.query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, userId]);
    await pool.query(
      'INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES ($1, $2, $3, $4, $5)',
      [userId, 'dice', betAmount, message, winAmount]
    );

    if (winAmount === 0) await processarComissaoAfiliado(userId, betAmount, 'bet_loss');

    sendRealTimeUpdate(userId, 'balance_update', { balance: newBalance });
    res.json({ success: true, dice: [d1, d2], sum, win: winAmount, newBalance, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no jogo' });
  }
});

// ========== JOGO CRASH ==========
app.post('/api/game/crash', async (req, res) => {
  const { userId, betAmount, cashoutMultiplier } = req.body;
  try {
    const userData = await pool.query(`
      SELECT u.balance, c.crash_min_bet
      FROM users u CROSS JOIN admin_config c WHERE u.id = $1
    `, [userId]);
    const data = userData.rows[0];
    if (!data) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (betAmount < data.crash_min_bet) return res.status(400).json({ error: `Aposta mínima: R$ ${data.crash_min_bet}` });

    const winAmount = betAmount * (cashoutMultiplier || 0);
    const newBalance = data.balance + winAmount;
    let message = '';
    if (cashoutMultiplier > 0) {
      message = `💰 RETIRADA! ${cashoutMultiplier.toFixed(2)}x +R$ ${winAmount.toFixed(2)}`;
    } else {
      message = `💥 CRASH! Perdeu R$ ${betAmount.toFixed(2)}`;
    }

    await pool.query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, userId]);
    await pool.query(
      'INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES ($1, $2, $3, $4, $5)',
      [userId, 'crash', betAmount, message, winAmount]
    );

    if (winAmount === 0) await processarComissaoAfiliado(userId, betAmount, 'bet_loss');

    sendRealTimeUpdate(userId, 'balance_update', { balance: newBalance });
    res.json({ success: true, newBalance, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no jogo' });
  }
});

// ========== JOGO ROLETA ==========
app.post('/api/game/roulette', async (req, res) => {
  const { userId, betAmount, betType, betValue } = req.body;
  try {
    const userData = await pool.query(`
      SELECT u.balance, u.status, c.roulette_min_bet
      FROM users u CROSS JOIN admin_config c WHERE u.id = $1
    `, [userId]);
    const data = userData.rows[0];
    if (!data) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (betAmount < data.roulette_min_bet) return res.status(400).json({ error: `Aposta mínima: R$ ${data.roulette_min_bet}` });
    if (data.balance < betAmount) return res.status(400).json({ error: 'Saldo insuficiente' });

    const result = Math.floor(Math.random() * 37);
    const color = result === 0 ? 'green' : (result % 2 === 0 ? 'red' : 'black');
    let winAmount = 0, message = '';

    if (betType === 'number' && betValue == result) {
      winAmount = betAmount * 35;
      message = `🎉 NÚMERO ${result}! +R$ ${winAmount.toFixed(2)}`;
    } else if (betType === 'color' && betValue === color) {
      winAmount = betAmount * 2;
      message = `🎉 COR ${color}! +R$ ${winAmount.toFixed(2)}`;
    } else if (betType === 'dozen') {
      const dozen = Math.floor((result - 1) / 12) + 1;
      if (betValue == dozen && result !== 0) {
        winAmount = betAmount * 3;
        message = `🎉 DÚZIA ${betValue}! +R$ ${winAmount.toFixed(2)}`;
      } else {
        message = `😢 PERDEU! Resultado: ${result}`;
      }
    } else if (betType === 'half') {
      if (result === 0) {
        message = `😢 PERDEU! Resultado: 0`;
      } else {
        const half = result <= 18 ? 'low' : 'high';
        if (betValue === half) {
          winAmount = betAmount * 2;
          message = `🎉 METADE ${half === 'low' ? '1-18' : '19-36'}! +R$ ${winAmount.toFixed(2)}`;
        } else {
          message = `😢 PERDEU! Resultado: ${result}`;
        }
      }
    } else {
      message = `😢 PERDEU! Resultado: ${result}`;
    }

    const newBalance = data.balance - betAmount + winAmount;
    await pool.query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, userId]);
    await pool.query(
      'INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES ($1, $2, $3, $4, $5)',
      [userId, 'roulette', betAmount, message, winAmount]
    );

    if (winAmount === 0) await processarComissaoAfiliado(userId, betAmount, 'bet_loss');

    sendRealTimeUpdate(userId, 'balance_update', { balance: newBalance });
    res.json({ success: true, result, color, win: winAmount, newBalance, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no jogo' });
  }
});

// ========== JOGO BLACKJACK ==========
app.post('/api/game/blackjack', async (req, res) => {
  const { userId, betAmount, action } = req.body;
  try {
    const userData = await pool.query(`
      SELECT u.balance, u.status, c.blackjack_min_bet
      FROM users u CROSS JOIN admin_config c WHERE u.id = $1
    `, [userId]);
    const data = userData.rows[0];
    if (!data) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (betAmount < data.blackjack_min_bet) return res.status(400).json({ error: `Aposta mínima: R$ ${data.blackjack_min_bet}` });
    if (data.balance < betAmount) return res.status(400).json({ error: 'Saldo insuficiente' });

    const playerCard1 = Math.floor(Math.random() * 10) + 1;
    const playerCard2 = Math.floor(Math.random() * 10) + 1;
    const playerSum = playerCard1 + playerCard2;
    const dealerCard = Math.floor(Math.random() * 10) + 1;

    let winAmount = 0, message = '';
    if (playerSum === 21) {
      winAmount = betAmount * 2.5;
      message = `🎉 BLACKJACK! +R$ ${winAmount.toFixed(2)}`;
    } else {
      message = `😢 PERDEU! Sua soma: ${playerSum}, Dealer: ${dealerCard}`;
    }

    const newBalance = data.balance - betAmount + winAmount;
    await pool.query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, userId]);
    await pool.query(
      'INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES ($1, $2, $3, $4, $5)',
      [userId, 'blackjack', betAmount, message, winAmount]
    );

    if (winAmount === 0) await processarComissaoAfiliado(userId, betAmount, 'bet_loss');

    sendRealTimeUpdate(userId, 'balance_update', { balance: newBalance });
    res.json({ success: true, playerCards: [playerCard1, playerCard2], playerSum, dealerCard, win: winAmount, newBalance, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no jogo' });
  }
});

// ========== AFILIADOS STATS ==========
app.get('/api/affiliate/stats/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    const user = await pool.query('SELECT affiliate_code, affiliate_balance, affiliate_commission FROM users WHERE id = $1', [userId]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    const refs = await pool.query('SELECT COUNT(*) as total_refs FROM users WHERE referred_by = $1', [userId]);
    const com = await pool.query('SELECT SUM(amount) as total_comissoes FROM affiliate_commissions WHERE affiliate_id = $1 AND status = $2', [userId, 'pending']);
    res.json({
      code: user.rows[0].affiliate_code,
      balance: user.rows[0].affiliate_balance,
      commission: user.rows[0].affiliate_commission,
      totalRefs: refs.rows[0].total_refs || 0,
      totalCommissions: com.rows[0].total_comissoes || 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

// ========== ROTAS ADMIN ==========
const checkAdmin = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  try {
    const base64 = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64, 'base64').toString('ascii');
    const [email, password] = credentials.split(':');
    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND status = $2', [email, 'Admin']);
    const admin = result.rows[0];
    if (!admin) return res.status(401).json({ error: 'Não autorizado' });
    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ error: 'Não autorizado' });
    req.admin = admin;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
};

app.get('/api/admin/stats', checkAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE status != 'Admin') as total_users,
        (SELECT COUNT(*) FROM users WHERE status = 'Ativo') as active_users,
        (SELECT SUM(balance) FROM users WHERE status != 'Admin') as total_balance,
        (SELECT COUNT(*) FROM deposits WHERE status = 'Pendente') as pending_deposits,
        (SELECT SUM(amount) FROM deposits WHERE status = 'Pendente') as pending_deposits_value,
        (SELECT COUNT(*) FROM withdraw_requests WHERE status = 'Pendente') as pending_withdraws,
        (SELECT SUM(amount) FROM withdraw_requests WHERE status = 'Pendente') as pending_withdraws_value,
        (SELECT SUM(amount) FROM deposits WHERE status = 'Confirmado') as total_deposits,
        (SELECT SUM(amount) FROM withdraw_requests WHERE status = 'Aprovado') as total_withdraws,
        (SELECT SUM(bet_amount) FROM game_history) as total_bets,
        (SELECT SUM(win_amount) FROM game_history) as total_wins
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

app.get('/api/admin/users', checkAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, email, pix_key, cpf, phone, balance, status,
             total_deposits, total_withdraws, total_bets, total_wins, rtp_individual,
             affiliate_code, referred_by, affiliate_balance, affiliate_commission
      FROM users WHERE status != 'Admin' ORDER BY id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar usuários' });
  }
});

app.get('/api/admin/user/:id', checkAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    const user = result.rows[0];
    delete user.password;
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

app.post('/api/admin/user/:id/update', checkAdmin, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const allowedFields = ['name', 'email', 'cpf', 'phone', 'pix_key', 'balance', 'status', 'rtp_individual', 'affiliate_commission'];
  const fields = [];
  const values = [];
  let idx = 1;
  Object.keys(updates).forEach(key => {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = $${idx++}`);
      values.push(updates[key]);
    }
  });
  if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo válido' });
  values.push(id);
  try {
    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    sendRealTimeUpdate(id, 'profile_update', updates);
    res.json({ success: true, message: 'Usuário atualizado!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

app.get('/api/admin/deposits', checkAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.*, u.name, u.email FROM deposits d
      JOIN users u ON d.user_id = u.id
      WHERE d.status = 'Pendente' ORDER BY d.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar depósitos' });
  }
});

app.post('/api/admin/confirm-deposit/:id', checkAdmin, async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Valor inválido' });
  const valor = parseFloat(amount);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deposit = await client.query('SELECT user_id, status FROM deposits WHERE id = $1 FOR UPDATE', [id]);
    if (deposit.rows.length === 0) throw new Error('Depósito não encontrado');
    if (deposit.rows[0].status !== 'Pendente') throw new Error('Depósito já processado');
    const user = await client.query('SELECT balance, referred_by FROM users WHERE id = $1 FOR UPDATE', [deposit.rows[0].user_id]);
    if (user.rows.length === 0) throw new Error('Usuário não encontrado');
    const balanceBefore = user.rows[0].balance;
    const balanceAfter = balanceBefore + valor;
    await client.query('UPDATE deposits SET status = $1, confirmed_by = $2, confirmed_at = CURRENT_TIMESTAMP WHERE id = $3', ['Confirmado', req.admin.id, id]);
    await client.query('UPDATE users SET balance = $1, total_deposits = total_deposits + $2, status = $3 WHERE id = $4', [balanceAfter, valor, 'Ativo', deposit.rows[0].user_id]);
    if (user.rows[0].referred_by) {
      const aff = await client.query('SELECT affiliate_commission FROM users WHERE id = $1', [user.rows[0].referred_by]);
      if (aff.rows.length > 0) {
        const commission = (valor * aff.rows[0].affiliate_commission) / 100;
        await client.query('UPDATE users SET affiliate_balance = affiliate_balance + $1 WHERE id = $2', [commission, user.rows[0].referred_by]);
        await client.query('INSERT INTO affiliate_commissions (affiliate_id, referred_id, amount, type, status) VALUES ($1, $2, $3, $4, $5)', [user.rows[0].referred_by, deposit.rows[0].user_id, commission, 'deposit', 'pending']);
        sendRealTimeUpdate(user.rows[0].referred_by, 'affiliate_commission', { amount: commission, type: 'deposit' });
      }
    }
    await client.query('COMMIT');
    sendRealTimeUpdate(deposit.rows[0].user_id, 'deposit_confirmed', { amount: valor, newBalance: balanceAfter });
    res.json({ success: true, message: '✅ Depósito confirmado!' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/admin/reject-deposit/:id', checkAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE deposits SET status = $1 WHERE id = $2', ['Rejeitado', req.params.id]);
    res.json({ message: 'Depósito rejeitado' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao rejeitar' });
  }
});

app.get('/api/admin/withdraws', checkAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT w.*, u.name as user_name, u.email FROM withdraw_requests w
      JOIN users u ON w.user_id = u.id
      WHERE w.status = 'Pendente' ORDER BY w.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar saques' });
  }
});

app.post('/api/admin/withdraw/:id/approve', checkAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const withdraw = await client.query('SELECT user_id, amount FROM withdraw_requests WHERE id = $1 AND status = $2 FOR UPDATE', [id, 'Pendente']);
    if (withdraw.rows.length === 0) throw new Error('Saque não encontrado');
    const user = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [withdraw.rows[0].user_id]);
    if (user.rows.length === 0) throw new Error('Usuário não encontrado');
    if (user.rows[0].balance < withdraw.rows[0].amount) throw new Error('Saldo insuficiente');
    const balanceAfter = user.rows[0].balance - withdraw.rows[0].amount;
    await client.query('UPDATE withdraw_requests SET status = $1, processed_by = $2, processed_at = CURRENT_TIMESTAMP WHERE id = $3', ['Aprovado', req.admin.id, id]);
    await client.query('UPDATE users SET balance = $1, total_withdraws = total_withdraws + $2 WHERE id = $3', [balanceAfter, withdraw.rows[0].amount, withdraw.rows[0].user_id]);
    await client.query('COMMIT');
    sendRealTimeUpdate(withdraw.rows[0].user_id, 'withdraw_approved', { amount: withdraw.rows[0].amount, newBalance: balanceAfter });
    res.json({ success: true, message: 'Saque aprovado!' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/admin/withdraw/:id/reject', checkAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  try {
    await pool.query('UPDATE withdraw_requests SET status = $1, processed_by = $2, notes = $3 WHERE id = $4', ['Rejeitado', req.admin.id, reason || '', id]);
    const withdraw = await pool.query('SELECT user_id, amount FROM withdraw_requests WHERE id = $1', [id]);
    if (withdraw.rows.length > 0) {
      sendRealTimeUpdate(withdraw.rows[0].user_id, 'withdraw_rejected', { amount: withdraw.rows[0].amount, reason });
    }
    res.json({ message: 'Saque rejeitado' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao rejeitar' });
  }
});

app.get('/api/admin/recent-history', checkAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT gh.*, u.name FROM game_history gh
      JOIN users u ON gh.user_id = u.id
      ORDER BY gh.created_at DESC LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

app.get('/api/admin/config', checkAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM admin_config WHERE id = 1');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

app.post('/api/admin/config', checkAdmin, async (req, res) => {
  const {
    pix_key, min_deposit, bonus_amount, min_withdraw, max_withdraw,
    withdraw_fee, slot_min_bet, dice_min_bet, crash_min_bet, roulette_min_bet, blackjack_min_bet,
    slot_rtp, dice_rtp, crash_rtp, roulette_rtp, blackjack_rtp,
    slot_volatility, dice_volatility, crash_volatility,
    site_name, contact_email, logo_path, primary_color
  } = req.body;

  try {
    await pool.query(`
      UPDATE admin_config SET
        pix_key = $1, min_deposit = $2, bonus_amount = $3, min_withdraw = $4, max_withdraw = $5,
        withdraw_fee = $6, slot_min_bet = $7, dice_min_bet = $8, crash_min_bet = $9, roulette_min_bet = $10, blackjack_min_bet = $11,
        slot_rtp = $12, dice_rtp = $13, crash_rtp = $14, roulette_rtp = $15, blackjack_rtp = $16,
        slot_volatility = $17, dice_volatility = $18, crash_volatility = $19,
        site_name = $20, contact_email = $21, logo_path = $22, primary_color = $23,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `,
      [pix_key, min_deposit, bonus_amount, min_withdraw, max_withdraw,
       withdraw_fee, slot_min_bet, dice_min_bet, crash_min_bet, roulette_min_bet, blackjack_min_bet,
       slot_rtp, dice_rtp, crash_rtp, roulette_rtp, blackjack_rtp,
       slot_volatility, dice_volatility, crash_volatility,
       site_name, contact_email, logo_path, primary_color]
    );
    const config = await pool.query('SELECT * FROM admin_config WHERE id = 1');
    sendToAllAdmins('config_updated', config.rows[0]);
    res.json({ success: true, message: '✅ Configurações salvas!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// ========== ROTAS DO USUÁRIO ==========
app.get('/api/user/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, email, pix_key, cpf, phone, balance, status,
             total_deposits, total_withdraws, total_bets, total_wins,
             affiliate_code, referred_by, affiliate_balance, affiliate_commission
      FROM users WHERE id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

app.get('/api/user/:id/history', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM game_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

// ========== ROTA PRINCIPAL ==========
app.get('/', (req, res) => res.redirect('/login'));

// ========== INICIAR SERVIDOR ==========
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📱 Login: http://localhost:${PORT}/login`);
  console.log(`👤 Cadastro: http://localhost:${PORT}/cadastro`);
  console.log(`🎮 Jogos: http://localhost:${PORT}/dashboard`);
  console.log(`⚙️ Admin: http://localhost:${PORT}/admin`);
  console.log(`🔌 WebSocket ativo`);
});