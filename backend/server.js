const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Configurações
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Conecta ao banco de dados SQLite
const db = new sqlite3.Database('./database.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) return console.error('Erro no banco:', err.message);
    console.log('✅ Conectado ao DB SQLite.');
    
    // Cria tabela de usuários
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        pix_key TEXT,
        balance REAL DEFAULT 0,
        status TEXT DEFAULT 'Pendente',
        total_deposits REAL DEFAULT 0,
        total_withdraws REAL DEFAULT 0,
        total_bets REAL DEFAULT 0,
        total_wins REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela de histórico de jogadas
    db.run(`CREATE TABLE IF NOT EXISTS game_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        game TEXT,
        bet_amount REAL,
        result TEXT,
        win_amount REAL,
        multiplier REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela de depósitos
    db.run(`CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL,
        status TEXT DEFAULT 'Pendente',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela de saques
    db.run(`CREATE TABLE IF NOT EXISTS withdraw_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL,
        status TEXT DEFAULT 'Pendente',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela de estatísticas da casa
    db.run(`CREATE TABLE IF NOT EXISTS house_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        total_bets REAL DEFAULT 0,
        total_paid REAL DEFAULT 0,
        house_profit REAL DEFAULT 0
    )`);

    // Configurações do admin
    db.run(`CREATE TABLE IF NOT EXISTS admin_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        pix_key TEXT,
        min_deposit REAL,
        bonus_amount REAL,
        min_withdraw REAL,
        slot_min_bet REAL DEFAULT 5,
        dice_min_bet REAL DEFAULT 5,
        crash_min_bet REAL DEFAULT 5,
        slot_rtp REAL DEFAULT 95,
        dice_rtp REAL DEFAULT 95,
        crash_rtp REAL DEFAULT 95,
        slot_volatility TEXT DEFAULT 'medium',
        dice_volatility TEXT DEFAULT 'medium',
        crash_volatility TEXT DEFAULT 'medium'
    )`, (err) => {
        if (!err) {
            db.get('SELECT * FROM admin_config WHERE id = 1', (err, row) => {
                if (!row) {
                    db.run(`INSERT INTO admin_config 
                        (id, pix_key, min_deposit, bonus_amount, min_withdraw, slot_rtp, dice_rtp, crash_rtp) 
                        VALUES (1, '1c5c21fc-fcbc-4b28-b285-74156c727917', 50, 30, 150, 95, 95, 95)`);
                }
            });
            
            // Inicializa estatísticas da casa
            db.run(`INSERT OR IGNORE INTO house_stats (id, total_bets, total_paid, house_profit) 
                    VALUES (1, 0, 0, 0)`);
            
            // Cria usuário admin padrão
            const saltRounds = 10;
            const adminPass = bcrypt.hashSync('admin123', saltRounds);
            db.run(`INSERT OR IGNORE INTO users (name, email, password, status) 
                    VALUES ('Administrador', 'admin@nexus.com', ?, 'Admin')`, [adminPass]);
        }
    });
});

// ===== ROTA DO QR CODE =====
app.get('/api/pix-qrcode', (req, res) => {
    const imagePath = path.join(__dirname, '../frontend/images/pix-nexus.png');
    
    if (fs.existsSync(imagePath)) {
        db.get('SELECT pix_key FROM admin_config WHERE id = 1', (err, row) => {
            if (err || !row) {
                return res.status(500).json({ error: 'Erro ao buscar chave PIX' });
            }
            
            res.json({ 
                success: true,
                qrcode: '/images/pix-nexus.png',
                pixKey: row.pix_key,
                message: 'QR Code carregado!'
            });
        });
    } else {
        res.status(404).json({ 
            error: 'Imagem do QR Code não encontrada' 
        });
    }
});

// ===== ROTAS DE AUTENTICAÇÃO =====
app.get('/cadastro', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/cadastro.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dashboard.html'));
});

app.post('/api/register', async (req, res) => {
    const { name, email, password, pixKey } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run('INSERT INTO users (name, email, password, pix_key) VALUES (?, ?, ?, ?)',
            [name, email, hashedPassword, pixKey || ''],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Email já cadastrado' });
                    }
                    return res.status(500).json({ error: 'Erro no cadastro' });
                }
                res.status(201).json({ 
                    id: this.lastID,
                    message: 'Cadastro realizado! Faça login.' 
                });
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'Erro interno' });
    }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }
        
        delete user.password;
        res.json({ 
            user,
            redirect: user.status === 'Admin' ? '/admin' : '/dashboard'
        });
    });
});

// ===== ROTAS DE DEPÓSITO =====
app.post('/api/request-deposit', (req, res) => {
    const { userId, amount } = req.body;
    
    db.run('INSERT INTO deposits (user_id, amount) VALUES (?, ?)',
        [userId, amount],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erro ao solicitar depósito' });
            }
            res.json({ 
                message: '✅ Depósito solicitado! Aguarde confirmação.',
                depositId: this.lastID
            });
        }
    );
});

// ===== ROTAS DE JOGOS =====

// Rota para jogar slots
app.post('/api/game/slot', (req, res) => {
    const { userId, betAmount } = req.body;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.get('SELECT balance, status FROM users WHERE id = ?', [userId], (err, user) => {
            if (err || !user) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }
            
            if (user.status === 'Pendente') {
                db.run('ROLLBACK');
                return res.status(400).json({ error: 'Usuário precisa ativar conta' });
            }
            
            if (user.balance < betAmount) {
                db.run('ROLLBACK');
                return res.status(400).json({ error: 'Saldo insuficiente' });
            }
            
            const symbols = ['🍒', '💎', '7️⃣', '⭐'];
            const multipliers = [2, 5, 10, 20];
            
            const r1 = Math.floor(Math.random() * symbols.length);
            const r2 = Math.floor(Math.random() * symbols.length);
            const r3 = Math.floor(Math.random() * symbols.length);
            
            let winAmount = 0;
            let message = '';
            
            if (r1 === r2 && r2 === r3) {
                winAmount = betAmount * multipliers[r1];
                message = `🎉 GRANDE VITÓRIA! +R$ ${winAmount.toFixed(2)}`;
            } else if (r1 === r2 || r2 === r3 || r1 === r3) {
                winAmount = betAmount * 0.5;
                message = `👍 PEQUENA VITÓRIA! +R$ ${winAmount.toFixed(2)}`;
            } else {
                winAmount = 0;
                message = `😢 PERDEU! -R$ ${betAmount.toFixed(2)}`;
            }
            
            const newBalance = user.balance - betAmount + winAmount;
            
            db.run('UPDATE users SET balance = ?, total_bets = total_bets + ?, total_wins = total_wins + ? WHERE id = ?',
                [newBalance, betAmount, winAmount, userId]);
            
            db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount, multiplier) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'slot', betAmount, message, winAmount, winAmount / betAmount]);
            
            db.run('COMMIT');
            
            res.json({
                success: true,
                symbols: [symbols[r1], symbols[r2], symbols[r3]],
                win: winAmount,
                multiplier: winAmount / betAmount,
                newBalance: newBalance,
                message: message
            });
        });
    });
});

// Rota para jogar dados
app.post('/api/game/dice', (req, res) => {
    const { userId, betAmount, betType } = req.body;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.get('SELECT balance, status FROM users WHERE id = ?', [userId], (err, user) => {
            if (err || !user) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }
            
            if (user.status === 'Pendente') {
                db.run('ROLLBACK');
                return res.status(400).json({ error: 'Usuário precisa ativar conta' });
            }
            
            if (user.balance < betAmount) {
                db.run('ROLLBACK');
                return res.status(400).json({ error: 'Saldo insuficiente' });
            }
            
            const d1 = Math.floor(Math.random() * 6) + 1;
            const d2 = Math.floor(Math.random() * 6) + 1;
            const sum = d1 + d2;
            
            let winAmount = 0;
            let message = '';
            
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
                winAmount = 0;
                message = `😢 PERDEU! Soma: ${sum} -R$ ${betAmount.toFixed(2)}`;
            }
            
            const newBalance = user.balance - betAmount + winAmount;
            
            db.run('UPDATE users SET balance = ?, total_bets = total_bets + ?, total_wins = total_wins + ? WHERE id = ?',
                [newBalance, betAmount, winAmount, userId]);
            
            db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount, multiplier) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'dice', betAmount, message, winAmount, winAmount / betAmount]);
            
            db.run('COMMIT');
            
            res.json({
                success: true,
                dice: [d1, d2],
                sum: sum,
                win: winAmount,
                multiplier: winAmount / betAmount,
                newBalance: newBalance,
                message: message
            });
        });
    });
});

// Rota para aviãozinho
app.post('/api/game/crash', (req, res) => {
    const { userId, betAmount, cashoutMultiplier } = req.body;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.get('SELECT balance FROM users WHERE id = ?', [userId], (err, user) => {
            if (err || !user) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }
            
            const winAmount = betAmount * cashoutMultiplier;
            const newBalance = user.balance + winAmount;
            
            let message = '';
            if (cashoutMultiplier > 0) {
                message = `💰 RETIRADA! ${cashoutMultiplier.toFixed(2)}x +R$ ${winAmount.toFixed(2)}`;
            } else {
                message = `💥 CRASH! Perdeu R$ ${betAmount.toFixed(2)}`;
            }
            
            db.run('UPDATE users SET balance = ?, total_bets = total_bets + ?, total_wins = total_wins + ? WHERE id = ?',
                [newBalance, betAmount, winAmount, userId]);
            
            db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount, multiplier) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'crash', betAmount, message, winAmount, cashoutMultiplier]);
            
            db.run('COMMIT');
            
            res.json({
                success: true,
                newBalance: newBalance,
                message: message
            });
        });
    });
});

// ===== ROTAS DO ADMIN =====

// Middleware de autenticação do admin (UMA ÚNICA VEZ!)
const checkAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        return res.status(401).json({ error: 'Não autorizado' });
    }
    
    try {
        const base64Credentials = authHeader.split(' ')[1];
        const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
        const [email, password] = credentials.split(':');
        
        db.get('SELECT * FROM users WHERE email = ? AND status = "Admin"', [email], async (err, admin) => {
            if (err || !admin) return res.status(401).json({ error: 'Não autorizado' });
            
            const validPassword = await bcrypt.compare(password, admin.password);
            if (!validPassword) return res.status(401).json({ error: 'Não autorizado' });
            
            req.admin = admin;
            next();
        });
    } catch (error) {
        return res.status(401).json({ error: 'Não autorizado' });
    }
};

// Estatísticas do dashboard
app.get('/api/admin/stats', checkAdmin, (req, res) => {
    db.get(`
        SELECT 
            (SELECT COUNT(*) FROM users WHERE status != 'Admin') as total_users,
            (SELECT SUM(balance) FROM users WHERE status != 'Admin') as total_balance,
            (SELECT COUNT(*) FROM deposits WHERE status = 'Pendente') as pending_deposits,
            (SELECT SUM(amount) FROM deposits WHERE status = 'Pendente') as pending_deposits_value,
            (SELECT COUNT(*) FROM withdraw_requests WHERE status = 'Pendente') as pending_withdraws,
            (SELECT SUM(amount) FROM withdraw_requests WHERE status = 'Pendente') as pending_withdraws_value
    `, [], (err, stats) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar estatísticas' });
        res.json(stats);
    });
});

// Listar todos os usuários
app.get('/api/admin/users', checkAdmin, (req, res) => {
    db.all(`
        SELECT id, name, email, balance, status, 
               total_deposits, total_withdraws, total_bets, total_wins,
               created_at 
        FROM users 
        WHERE status != 'Admin'
        ORDER BY id DESC
    `, [], (err, users) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar usuários' });
        res.json(users);
    });
});

// Listar depósitos pendentes
app.get('/api/admin/deposits', checkAdmin, (req, res) => {
    db.all(`
        SELECT d.*, u.name, u.email, u.pix_key 
        FROM deposits d 
        JOIN users u ON d.user_id = u.id 
        WHERE d.status = 'Pendente'
        ORDER BY d.created_at DESC
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar depósitos' });
        res.json(rows);
    });
});

// Confirmar depósito
app.post('/api/admin/confirm-deposit/:id', checkAdmin, (req, res) => {
    const { id } = req.params;
    const { amount } = req.body;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.get('SELECT user_id FROM deposits WHERE id = ?', [id], (err, deposit) => {
            if (err || !deposit) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Depósito não encontrado' });
            }
            
            db.run('UPDATE deposits SET status = "Confirmado" WHERE id = ?', [id]);
            
            db.run('UPDATE users SET balance = balance + ?, total_deposits = total_deposits + ?, status = "Ativo" WHERE id = ?',
                [amount, amount, deposit.user_id]);
            
            db.run('COMMIT');
            res.json({ message: 'Depósito confirmado com sucesso!' });
        });
    });
});

// Rejeitar depósito
app.post('/api/admin/reject-deposit/:id', checkAdmin, (req, res) => {
    const { id } = req.params;
    
    db.run('UPDATE deposits SET status = "Rejeitado" WHERE id = ?', [id], function(err) {
        if (err) return res.status(500).json({ error: 'Erro ao rejeitar depósito' });
        res.json({ message: 'Depósito rejeitado' });
    });
});

// Listar saques pendentes
app.get('/api/admin/withdraws', checkAdmin, (req, res) => {
    db.all(`
        SELECT wr.*, u.name, u.email, u.pix_key 
        FROM withdraw_requests wr 
        JOIN users u ON wr.user_id = u.id 
        WHERE wr.status = 'Pendente'
        ORDER BY wr.created_at DESC
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar saques' });
        res.json(rows);
    });
});

// Aprovar saque
app.post('/api/admin/withdraw/:id/approve', checkAdmin, (req, res) => {
    const { id } = req.params;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.get('SELECT user_id, amount FROM withdraw_requests WHERE id = ?', [id], (err, withdraw) => {
            if (err || !withdraw) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Saque não encontrado' });
            }
            
            db.run('UPDATE users SET balance = balance - ?, total_withdraws = total_withdraws + ? WHERE id = ?',
                [withdraw.amount, withdraw.amount, withdraw.user_id]);
            
            db.run('UPDATE withdraw_requests SET status = "Aprovado" WHERE id = ?', [id]);
            
            db.run('COMMIT');
            res.json({ message: 'Saque aprovado com sucesso!' });
        });
    });
});

// Rejeitar saque
app.post('/api/admin/withdraw/:id/reject', checkAdmin, (req, res) => {
    const { id } = req.params;
    
    db.run('UPDATE withdraw_requests SET status = "Rejeitado" WHERE id = ?', [id], function(err) {
        if (err) return res.status(500).json({ error: 'Erro ao rejeitar saque' });
        res.json({ message: 'Saque rejeitado!' });
    });
});

// Buscar histórico recente
app.get('/api/admin/recent-history', checkAdmin, (req, res) => {
    db.all(`
        SELECT gh.*, u.name 
        FROM game_history gh
        JOIN users u ON gh.user_id = u.id
        ORDER BY gh.created_at DESC
        LIMIT 100
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar histórico' });
        res.json(rows);
    });
});

// Buscar configurações
app.get('/api/admin/config', checkAdmin, (req, res) => {
    db.get('SELECT * FROM admin_config WHERE id = 1', (err, config) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar configurações' });
        res.json(config);
    });
});

// Atualizar configurações
app.post('/api/admin/config', checkAdmin, (req, res) => {
    const {
        pix_key,
        min_deposit,
        bonus_amount,
        min_withdraw,
        slot_min_bet,
        dice_min_bet,
        slot_rtp,
        dice_rtp,
        crash_rtp,
        slot_volatility,
        dice_volatility,
        crash_volatility
    } = req.body;
    
    db.run(`
        UPDATE admin_config SET
            pix_key = ?,
            min_deposit = ?,
            bonus_amount = ?,
            min_withdraw = ?,
            slot_min_bet = ?,
            dice_min_bet = ?,
            slot_rtp = ?,
            dice_rtp = ?,
            crash_rtp = ?,
            slot_volatility = ?,
            dice_volatility = ?,
            crash_volatility = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
    `,
        [pix_key, min_deposit, bonus_amount, min_withdraw, slot_min_bet, dice_min_bet,
         slot_rtp, dice_rtp, crash_rtp, slot_volatility, dice_volatility, crash_volatility],
        function(err) {
            if (err) return res.status(500).json({ error: 'Erro ao atualizar configurações' });
            res.json({ message: 'Configurações atualizadas!' });
        }
    );
});

// Buscar dados do usuário
app.get('/api/user/:id', (req, res) => {
    db.get('SELECT id, name, email, pix_key, balance, status, total_deposits, total_withdraws, total_bets, total_wins FROM users WHERE id = ?',
        [req.params.id],
        (err, user) => {
            if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
            res.json(user);
        }
    );
});

// Buscar histórico do usuário
app.get('/api/user/:id/history', (req, res) => {
    db.all('SELECT * FROM game_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
        [req.params.id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: 'Erro ao buscar histórico' });
            res.json(rows);
        }
    );
});

// Solicitar saque
app.post('/api/request-withdraw', (req, res) => {
    const { userId, amount } = req.body;
    
    db.get('SELECT balance FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
        if (user.balance < amount) return res.status(400).json({ error: 'Saldo insuficiente' });
        
        db.get('SELECT min_withdraw FROM admin_config WHERE id = 1', (err, config) => {
            if (amount < config.min_withdraw) {
                return res.status(400).json({ error: `Saque mínimo: R$${config.min_withdraw}` });
            }
            
            db.run('INSERT INTO withdraw_requests (user_id, amount) VALUES (?, ?)',
                [userId, amount],
                function(err) {
                    if (err) return res.status(500).json({ error: 'Erro ao solicitar saque' });
                    res.json({ message: 'Saque solicitado!' });
                }
            );
        });
    });
});

// Rota principal
app.get('/', (req, res) => {
    res.redirect('/login');
});

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📱 Login: https://nexus-trade-app1.onrender.com/login`);
    console.log(`👤 Cadastro: https://nexus-trade-app1.onrender.com/cadastro`);
    console.log(`⚙️ Admin: https://nexus-trade-app1.onrender.com/admin`);
    console.log(`🖼️ QR Code estático: /images/pix-nexus.png`);
});