const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const cashinpayApi = require('./config/cashinpay'); // ← NOVO

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Banco de dados
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('❌ Erro ao conectar ao banco:', err);
  } else {
    console.log('✅ Banco de dados SQLite conectado.');
    criarTabelas();
  }
});

function criarTabelas() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      balance REAL DEFAULT 0,
      bonus_balance REAL DEFAULT 0,
      rollover REAL DEFAULT 0,
      status TEXT DEFAULT 'Ativo',
      rtp_individual REAL,
      pix_key TEXT,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      bonus REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      gateway_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      confirmed_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS withdraws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      pix_key TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      rtp REAL DEFAULT 95,
      min_bet REAL DEFAULT 5,
      max_bet REAL DEFAULT 1000,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS game_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      game TEXT NOT NULL,
      bet_amount REAL NOT NULL,
      win_amount REAL DEFAULT 0,
      result TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pix_key TEXT DEFAULT 'chave_pix_admin',
      min_deposit REAL DEFAULT 20,
      bonus_deposit REAL DEFAULT 30,
      min_withdraw REAL DEFAULT 50,
      max_withdraw REAL DEFAULT 5000,
      withdraw_fee REAL DEFAULT 0
    );
  `, (err) => {
    if (err) {
      console.error('❌ Erro ao criar tabelas:', err);
    } else {
      console.log('✅ Tabelas verificadas/criadas.');
      
      const adminEmail = 'edu7k001@gmail.com';
      const adminPassword = bcrypt.hashSync('@Carlos1998', 10);
      db.get('SELECT * FROM admins WHERE email = ?', [adminEmail], (err, admin) => {
        if (!admin) {
          db.run('INSERT INTO admins (email, password, name) VALUES (?, ?, ?)',
            [adminEmail, adminPassword, 'Administrador']);
          console.log('✅ Admin padrão criado.');
        }
      });
      
      db.run('INSERT OR IGNORE INTO config (id) VALUES (1)');
      
      const jogos = [
        ['fortune-ox', 96.75, 5, 1000],
        ['thimbles', 97, 5, 1000]
      ];
      jogos.forEach(jogo => {
        db.run('INSERT OR IGNORE INTO games (name, rtp, min_bet, max_bet) VALUES (?, ?, ?, ?)', jogo);
      });
    }
  });
}

// ==================== ROTAS PÚBLICAS ====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/admin-login.html', (req, res) => res.sendFile(path.join(__dirname, 'admin-login.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/deposit.html', (req, res) => res.sendFile(path.join(__dirname, 'deposit.html')));
app.get('/withdraw.html', (req, res) => res.sendFile(path.join(__dirname, 'withdraw.html')));
app.get('/fortune-ox.html', (req, res) => res.sendFile(path.join(__dirname, 'fortune-ox.html')));
app.get('/thimbles.html', (req, res) => res.sendFile(path.join(__dirname, 'thimbles.html')));

// ==================== ROTAS DE API ====================
app.get('/api/teste', (req, res) => {
  res.json({ success: true, message: 'API funcionando perfeitamente!' });
});

app.post('/api/register', (req, res) => {
  const { name, email, password, pix_key, phone } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }
  const hashedPassword = bcrypt.hashSync(password, 10);
  db.run('INSERT INTO users (name, email, password, pix_key, phone) VALUES (?, ?, ?, ?, ?)',
    [name, email, hashedPassword, pix_key || null, phone || null],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'E-mail já cadastrado' });
        }
        return res.status(500).json({ error: 'Erro interno' });
      }
      res.json({ success: true, message: 'Cadastro realizado com sucesso' });
    }
  );
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err || !user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        balance: user.balance,
        bonus_balance: user.bonus_balance,
        pix_key: user.pix_key,
        phone: user.phone
      },
      redirect: '/dashboard.html'
    });
  });
});

app.get('/api/user/:id/balance', (req, res) => {
  db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [req.params.id], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(user);
  });
});

// ==================== ROTAS DE DEPÓSITO ====================

// Rota para criar transação PIX via CashinPay
app.post('/api/cashinpay/deposit', async (req, res) => {
  const { userId, amount, customerName, customerEmail, customerPhone } = req.body;

  if (!userId || !amount || amount < 5) {
    return res.status(400).json({ error: 'Valor mínimo R$5,00' });
  }
  if (!customerName || !customerEmail || !customerPhone) {
    return res.status(400).json({ error: 'Dados do cliente incompletos' });
  }

  try {
    const response = await cashinpayApi.post('/transactions', {
      amount: parseFloat(amount),
      description: `Depósito MEGABET777 - Usuário ${userId}`,
      customer: {
        name: customerName,
        email: customerEmail,
        phone: customerPhone.replace(/\D/g, ''),
      },
    });

    const transaction = response.data.data;

    db.run(
      'INSERT INTO deposits (user_id, amount, status, gateway_id) VALUES (?, ?, ?, ?)',
      [userId, amount, 'pending', transaction.id],
      (err) => {
        if (err) console.error('Erro ao salvar depósito:', err);
      }
    );

    res.json({
      success: true,
      qrCode: transaction.pix.qrcode,
      copyPaste: transaction.pix.copy_paste,
      expiresAt: transaction.pix.expiration_date,
      transactionId: transaction.id,
    });
  } catch (error) {
    console.error('Erro CashinPay:', error.response?.data || error.message);
    res.status(500).json({ error: 'Erro ao gerar pagamento' });
  }
});

// Webhook da CashinPay
app.post('/api/cashinpay/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = JSON.parse(req.body);
  } catch (e) {
    return res.status(400).send('Invalid JSON');
  }

  if (event.event === 'transaction.paid') {
    const transaction = event.data;
    const gatewayId = transaction.id;
    const amount = transaction.amount.value;

    db.get('SELECT user_id FROM deposits WHERE gateway_id = ?', [gatewayId], (err, deposit) => {
      if (err || !deposit) {
        console.error('Depósito não encontrado para gatewayId:', gatewayId);
        return res.status(200).send('OK');
      }

      db.run(
        'UPDATE users SET balance = balance + ? WHERE id = ?',
        [amount, deposit.user_id],
        (err) => {
          if (err) {
            console.error('Erro ao atualizar saldo:', err);
          } else {
            db.run('UPDATE deposits SET status = "confirmed" WHERE gateway_id = ?', [gatewayId]);
            console.log(`✅ Depósito de R$ ${amount} confirmado para usuário ${deposit.user_id}`);
          }
        }
      );
    });
  }

  res.status(200).send('OK');
});

// ==================== ROTAS DE SAQUE ====================
app.post('/api/withdraw/request', (req, res) => {
  const { user_id, amount, pix_key } = req.body;
  if (!user_id || !amount || !pix_key) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  db.get('SELECT balance FROM users WHERE id = ?', [user_id], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (user.balance < amount) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, user_id], (err) => {
      if (err) return res.status(500).json({ error: 'Erro ao debitar saldo' });
      
      db.run('INSERT INTO withdraws (user_id, amount, pix_key, status) VALUES (?, ?, ?, ?)',
        [user_id, amount, pix_key, 'pending'],
        function(err) {
          if (err) {
            db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, user_id]);
            return res.status(500).json({ error: 'Erro ao registrar saque' });
          }
          res.json({ success: true, message: 'Saque solicitado com sucesso' });
        }
      );
    });
  });
});

// ==================== ROTAS ADMIN ====================
function checkAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  const base64 = auth.split(' ')[1];
  const [email, password] = Buffer.from(base64, 'base64').toString().split(':');
  if (email !== 'edu7k001@gmail.com' || password !== '@Carlos1998') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  next();
}

app.post('/api/admin-login', (req, res) => {
  const { email, password } = req.body;
  if (email === 'edu7k001@gmail.com' && password === '@Carlos1998') {
    return res.json({ success: true, admin: { email } });
  }
  res.status(401).json({ error: 'Credenciais inválidas' });
});

app.get('/api/admin/stats', checkAdmin, (req, res) => {
  db.get('SELECT COUNT(*) as total_users FROM users', (err, users) => {
    db.get('SELECT COUNT(*) as pending_deposits FROM deposits WHERE status = "pending"', (err, deposits) => {
      db.get('SELECT COUNT(*) as pending_withdraws FROM withdraws WHERE status = "pending"', (err, withdraws) => {
        db.get('SELECT SUM(balance + bonus_balance) as total_balance FROM users', (err, balance) => {
          res.json({
            total_users: users?.total_users || 0,
            pending_deposits: deposits?.pending_deposits || 0,
            pending_withdraws: withdraws?.pending_withdraws || 0,
            total_balance: balance?.total_balance || 0,
            online_users: 1
          });
        });
      });
    });
  });
});

app.get('/api/admin/users', checkAdmin, (req, res) => {
  db.all('SELECT id, name, email, balance, bonus_balance, rollover, status, rtp_individual, pix_key, phone FROM users', [], (err, users) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(users);
  });
});

app.post('/api/admin/user/:id/update', checkAdmin, (req, res) => {
  const { id } = req.params;
  const { balance, bonus_balance, rollover, status, rtp_individual } = req.body;
  db.run(
    'UPDATE users SET balance = ?, bonus_balance = ?, rollover = ?, status = ?, rtp_individual = ? WHERE id = ?',
    [balance, bonus_balance, rollover, status, rtp_individual, id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.get('/api/admin/deposits', checkAdmin, (req, res) => {
  db.all('SELECT d.*, u.name FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.status = "pending" ORDER BY d.created_at DESC', [], (err, deposits) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(deposits);
  });
});

app.post('/api/admin/confirm-deposit/:id', checkAdmin, (req, res) => {
  const { id } = req.params;
  const { amount, bonus } = req.body;
  db.get('SELECT user_id FROM deposits WHERE id = ?', [id], (err, deposit) => {
    if (!deposit) return res.status(404).json({ error: 'Depósito não encontrado' });
    db.run('UPDATE users SET balance = balance + ?, bonus_balance = bonus_balance + ? WHERE id = ?',
      [amount, bonus, deposit.user_id]);
    db.run('UPDATE deposits SET status = "confirmed", confirmed_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    db.run('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
      [deposit.user_id, 'deposit', amount + bonus, `Depósito de R$ ${amount} + bônus R$ ${bonus}`]);
    res.json({ success: true });
  });
});

app.get('/api/admin/withdraws', checkAdmin, (req, res) => {
  db.all('SELECT w.*, u.name FROM withdraws w JOIN users u ON w.user_id = u.id WHERE w.status = "pending" ORDER BY w.created_at DESC', [], (err, withdraws) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(withdraws);
  });
});

app.post('/api/admin/approve-withdraw/:id', checkAdmin, (req, res) => {
  const { id } = req.params;
  db.run('UPDATE withdraws SET status = "approved", processed_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
  res.json({ success: true });
});

app.post('/api/admin/reject-withdraw/:id', checkAdmin, (req, res) => {
  const { id } = req.params;
  db.get('SELECT user_id, amount FROM withdraws WHERE id = ?', [id], (err, withdraw) => {
    if (withdraw) {
      db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [withdraw.amount, withdraw.user_id]);
      db.run('UPDATE withdraws SET status = "rejected" WHERE id = ?', [id]);
    }
    res.json({ success: true });
  });
});

app.get('/api/admin/games', checkAdmin, (req, res) => {
  db.all('SELECT * FROM games ORDER BY id', [], (err, games) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(games);
  });
});

app.post('/api/admin/game/:name', checkAdmin, (req, res) => {
  const { name } = req.params;
  const { rtp, min_bet, max_bet, active } = req.body;
  db.run(
    'UPDATE games SET rtp = ?, min_bet = ?, max_bet = ?, active = ? WHERE name = ?',
    [rtp, min_bet, max_bet, active, name],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.get('/api/admin/config', checkAdmin, (req, res) => {
  db.get('SELECT * FROM config WHERE id = 1', (err, config) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(config);
  });
});

app.post('/api/admin/config', checkAdmin, (req, res) => {
  const { pix_key, min_deposit, bonus_deposit, min_withdraw, max_withdraw, withdraw_fee } = req.body;
  db.run(
    `UPDATE config SET pix_key = ?, min_deposit = ?, bonus_deposit = ?, min_withdraw = ?, max_withdraw = ?, withdraw_fee = ? WHERE id = 1`,
    [pix_key, min_deposit, bonus_deposit, min_withdraw, max_withdraw, withdraw_fee],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

// ==================== ROTAS DE JOGOS ====================
function processarAposta(userId, gameName, betAmount, winAmountBase, rtpGlobal, callback) {
  db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
    if (err || !user) return callback('Usuário não encontrado');
    
    const total = user.balance + user.bonus_balance;
    if (total < betAmount) return callback('Saldo insuficiente');
    
    let winAmount = winAmountBase;
    if (user.rtp_individual) {
      winAmount = Math.floor(winAmountBase * (user.rtp_individual / 100));
    } else {
      winAmount = Math.floor(winAmountBase * (rtpGlobal / 100));
    }
    
    let newBalance = user.balance;
    let newBonus = user.bonus_balance;
    let novoRollover = user.rollover;
    
    if (user.bonus_balance >= betAmount) {
      newBonus -= betAmount;
    } else {
      newBalance -= (betAmount - user.bonus_balance);
      newBonus = 0;
    }
    
    if (winAmount > 0) {
      newBalance += winAmount;
      if (novoRollover > 0) {
        novoRollover = Math.max(0, novoRollover - betAmount);
      }
    }
    
    db.run(
      'UPDATE users SET balance = ?, bonus_balance = ?, rollover = ? WHERE id = ?',
      [newBalance, newBonus, novoRollover, userId],
      (err) => {
        if (err) return callback(err);
        db.run(
          'INSERT INTO game_history (user_id, game, bet_amount, win_amount, result) VALUES (?, ?, ?, ?, ?)',
          [userId, gameName, betAmount, winAmount, winAmount > 0 ? 'win' : 'lose']
        );
        callback(null, { newBalance: newBalance + newBonus, winAmount });
      }
    );
  });
}

app.post('/api/game/fortune-ox', (req, res) => {
  const { userId, betAmount } = req.body;
  if (!userId || !betAmount || betAmount < 5) {
    return res.status(400).json({ error: 'Aposta inválida' });
  }
  db.get('SELECT * FROM games WHERE name = "fortune-ox"', (err, game) => {
    if (!game || !game.active) return res.status(400).json({ error: 'Jogo indisponível' });
    
    const symbols = ['🐂', '🪙', '🧧', '💰', '🧨', '🍊', '🎆'];
    const resultado = [
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)]
    ];
    
    let winBase = 0;
    if (resultado[0] === resultado[1] && resultado[1] === resultado[2]) {
      if (resultado[0] === '🐂') winBase = betAmount * 20;
      else winBase = betAmount * 5;
    }
    
    processarAposta(userId, 'fortune-ox', betAmount, winBase, game.rtp, (err, data) => {
      if (err) return res.status(400).json({ error: err });
      res.json({
        success: true,
        result: resultado,
        winAmount: data.winAmount,
        newBalance: data.newBalance,
        message: data.winAmount > 0 ? `🎉 Ganhou R$ ${data.winAmount.toFixed(2)}!` : `😢 Perdeu R$ ${betAmount.toFixed(2)}`
      });
    });
  });
});

app.post('/api/game/thimbles', (req, res) => {
  const { userId, betAmount, escolha } = req.body;
  if (!userId || !betAmount || betAmount < 5 || ![0, 1, 2].includes(escolha)) {
    return res.status(400).json({ error: 'Aposta inválida' });
  }
  db.get('SELECT * FROM games WHERE name = "thimbles"', (err, game) => {
    if (!game || !game.active) return res.status(400).json({ error: 'Jogo indisponível' });
    
    const posicaoCorreta = Math.floor(Math.random() * 3);
    const ganhou = (posicaoCorreta === escolha);
    const winBase = ganhou ? betAmount * 2.88 : 0;
    
    processarAposta(userId, 'thimbles', betAmount, winBase, game.rtp, (err, data) => {
      if (err) return res.status(400).json({ error: err });
      res.json({
        success: true,
        posicaoCorreta,
        ganhou,
        winAmount: data.winAmount,
        newBalance: data.newBalance,
        message: ganhou ? `🎉 Acertou! Ganhou R$ ${data.winAmount.toFixed(2)}!` : `😢 Errou! A bolinha estava no copo ${posicaoCorreta+1}.`
      });
    });
  });
});

// ==================== INICIAR SERVIDOR ====================
app.listen(PORT, () => {
  console.log('\n=================================');
  console.log(`🚀 MEGABET777 rodando na porta ${PORT}`);
  console.log(`📁 Servindo arquivos da raiz`);
  console.log(`👑 Admin: edu7k001@gmail.com / @Carlos1998`);
  console.log('=================================\n');
});
