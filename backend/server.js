const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend'))); // Serve os arquivos da pasta frontend

// Conecta ao banco de dados SQLite
const db = new sqlite3.Database('./database.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) return console.error(err.message);
    console.log('✅ Conectado ao DB SQLite.');
    
    // Cria as tabelas
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        cpf TEXT,
        phone TEXT,
        pix_key TEXT UNIQUE,
        balance REAL DEFAULT 0,
        status TEXT DEFAULT 'Pendente',
        rtp_individual REAL,
        affiliate_commission REAL DEFAULT 10,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS withdraw_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL,
        name TEXT,
        cpf TEXT,
        pix_key TEXT,
        status TEXT DEFAULT 'Pendente',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS deposit_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL,
        status TEXT DEFAULT 'Pendente',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admin_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        pix_key TEXT,
        min_deposit REAL DEFAULT 20,
        bonus_amount REAL DEFAULT 30,
        min_withdraw REAL DEFAULT 150,
        max_withdraw REAL DEFAULT 5000,
        withdraw_fee REAL DEFAULT 0,
        initial_bonus REAL DEFAULT 20,
        initial_goal REAL DEFAULT 100,
        required_deposit REAL DEFAULT 50,
        post_deposit_goal REAL DEFAULT 500,
        slot_min_bet REAL DEFAULT 5,
        dice_min_bet REAL DEFAULT 5,
        crash_min_bet REAL DEFAULT 5,
        roulette_min_bet REAL DEFAULT 5,
        blackjack_min_bet REAL DEFAULT 5,
        slot_rtp REAL DEFAULT 95,
        dice_rtp REAL DEFAULT 95,
        crash_rtp REAL DEFAULT 95,
        roulette_rtp REAL DEFAULT 95,
        blackjack_rtp REAL DEFAULT 95
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS game_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        game TEXT,
        bet_amount REAL,
        result TEXT,
        win_amount REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Insere configuração padrão se não existir
    db.run(`INSERT OR IGNORE INTO admin_config (id, pix_key, min_deposit, bonus_amount, min_withdraw, max_withdraw, withdraw_fee, initial_bonus, initial_goal, required_deposit, post_deposit_goal, slot_min_bet, dice_min_bet, crash_min_bet, roulette_min_bet, blackjack_min_bet, slot_rtp, dice_rtp, crash_rtp, roulette_rtp, blackjack_rtp) 
            VALUES (1, 'SUA_CHAVE_PIX_AQUI', 20, 30, 150, 5000, 0, 20, 100, 50, 500, 5, 5, 5, 5, 5, 95, 95, 95, 95, 95)`);
    
    // Cria um admin padrão (opcional)
    db.run(`INSERT OR IGNORE INTO users (name, email, password, status) VALUES ('Admin', 'admin@nexus.com', 'admin123', 'Admin')`);
});

// ==================== ROTAS PÚBLICAS ====================

// Rota principal - serve o index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Rota para servir qualquer arquivo HTML da pasta frontend
app.get('/:page', (req, res) => {
    const page = req.params.page;
    const filePath = path.join(__dirname, '../frontend', `${page}.html`);
    res.sendFile(filePath, (err) => {
        if (err) {
            res.status(404).sendFile(path.join(__dirname, '../frontend/404.html'));
        }
    });
});

// Rota de cadastro
app.post('/api/register', (req, res) => {
    const { name, email, password, cpf, phone, pixKey, ref } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Nome, e-mail e senha obrigatórios.' });
    }

    // Busca configuração para pegar o bônus inicial
    db.get('SELECT initial_bonus FROM admin_config WHERE id = 1', (err, config) => {
        const initialBonus = config ? config.initial_bonus : 20;
        
        const sql = 'INSERT INTO users (name, email, password, cpf, phone, pix_key, balance, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        db.run(sql, [name, email, password, cpf, phone, pixKey, initialBonus, 'Pendente'], function(err) {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Erro no cadastro. E-mail ou chave PIX já existe.' });
            }
            res.status(201).json({ 
                id: this.lastID, 
                name, 
                email, 
                message: 'Cadastro realizado com sucesso! Bônus de R$ ' + initialBonus + ' creditado.' 
            });
        });
    });
});

// Rota de login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    db.get('SELECT * FROM users WHERE email = ? AND password = ?', [email, password], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
        }
        
        // Determina redirecionamento baseado no status
        let redirect = '/dashboard';
        if (user.status === 'Admin') {
            redirect = '/admin';
        }
        
        res.json({ 
            user: { 
                id: user.id, 
                name: user.name, 
                email: user.email, 
                balance: user.balance,
                status: user.status,
                pix_key: user.pix_key
            }, 
            redirect 
        });
    });
});

// Rota de login admin
app.post('/api/admin-login', (req, res) => {
    const { email, password } = req.body;
    
    db.get('SELECT * FROM users WHERE email = ? AND password = ? AND status = "Admin"', [email, password], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Credenciais de admin inválidas.' });
        }
        
        res.json({ 
            user: { 
                id: user.id, 
                name: user.name, 
                email: user.email, 
                status: user.status
            }
        });
    });
});

// Rota para obter dados do usuário
app.get('/api/user/:id', (req, res) => {
    db.get('SELECT id, name, email, cpf, phone, pix_key, balance, status FROM users WHERE id = ?', [req.params.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado.' });
        res.json(user);
    });
});

// Rota para gerar QR Code da chave PIX do admin
app.get('/api/pix-qrcode', async (req, res) => {
    db.get('SELECT pix_key FROM admin_config WHERE id = 1', async (err, row) => {
        if (err || !row || row.pix_key === 'SUA_CHAVE_PIX_AQUI') {
            return res.status(500).json({ error: 'Chave PIX não configurada no servidor.' });
        }
        try {
            const qrCodeDataUrl = await QRCode.toDataURL(row.pix_key);
            res.json({ qrcode: qrCodeDataUrl, pixKey: row.pix_key });
        } catch (err) {
            res.status(500).json({ error: 'Erro ao gerar QR Code.' });
        }
    });
});

// Rota para solicitar depósito
app.post('/api/request-deposit', (req, res) => {
    const { userId, amount } = req.body;
    
    if (!userId || !amount || amount < 20) {
        return res.status(400).json({ error: 'Valor mínimo de depósito: R$ 20' });
    }
    
    db.run('INSERT INTO deposit_requests (user_id, amount) VALUES (?, ?)', [userId, amount], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Erro ao solicitar depósito.' });
        }
        res.json({ message: 'Solicitação de depósito registrada. Aguarde confirmação.' });
    });
});

// ==================== ROTAS DE JOGOS ====================

// Slot machine
app.post('/api/game/slot', (req, res) => {
    const { userId, betAmount } = req.body;
    
    db.get('SELECT balance, status FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado.' });
        if (user.balance < betAmount) return res.status(400).json({ error: 'Saldo insuficiente.' });
        
        // Simula resultado do slot (você pode personalizar)
        const symbols = ['🍒', '🍋', '🍊', '7️⃣', '💎', '🎰'];
        const reel1 = symbols[Math.floor(Math.random() * symbols.length)];
        const reel2 = symbols[Math.floor(Math.random() * symbols.length)];
        const reel3 = symbols[Math.floor(Math.random() * symbols.length)];
        
        let win = 0;
        let message = '';
        
        if (reel1 === reel2 && reel2 === reel3) {
            win = betAmount * 10;
            message = `🎉 VITÓRIA! ${reel1} ${reel2} ${reel3} +R$ ${win.toFixed(2)}`;
        } else if (reel1 === reel2 || reel2 === reel3 || reel1 === reel3) {
            win = betAmount * 2;
            message = `👍 PARCIAL! +R$ ${win.toFixed(2)}`;
        } else {
            message = `😢 Perdeu R$ ${betAmount.toFixed(2)}`;
        }
        
        const newBalance = user.balance - betAmount + win;
        
        db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId], (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao atualizar saldo.' });
            
            // Registra no histórico
            db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES (?, ?, ?, ?, ?)',
                [userId, 'slot', betAmount, win > 0 ? 'win' : 'lose', win]);
            
            res.json({ 
                symbols: [reel1, reel2, reel3], 
                win, 
                newBalance, 
                message 
            });
        });
    });
});

// Dados
app.post('/api/game/dice', (req, res) => {
    const { userId, betAmount, betType } = req.body;
    
    db.get('SELECT balance FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado.' });
        if (user.balance < betAmount) return res.status(400).json({ error: 'Saldo insuficiente.' });
        
        const dice1 = Math.floor(Math.random() * 6) + 1;
        const dice2 = Math.floor(Math.random() * 6) + 1;
        const sum = dice1 + dice2;
        
        let win = 0;
        let multiplier = 0;
        
        if (betType.type === 'sum') {
            if (sum === betType.value) {
                multiplier = betType.value === 7 ? 5 : 15;
                win = betAmount * multiplier;
            }
        } else if (betType.type === 'double') {
            if (dice1 === dice2) {
                multiplier = 8;
                win = betAmount * multiplier;
            }
        } else if (betType.type === 'specific') {
            if (dice1 === betType.value || dice2 === betType.value) {
                multiplier = 6;
                win = betAmount * multiplier;
            }
        }
        
        const newBalance = user.balance - betAmount + win;
        const message = win > 0 ? 
            `🎉 Ganhou! Dados: ${dice1}+${dice2}=${sum} (${multiplier}x) +R$ ${win.toFixed(2)}` : 
            `😢 Perdeu! Dados: ${dice1}+${dice2}=${sum}`;
        
        db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId], (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao atualizar saldo.' });
            
            db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES (?, ?, ?, ?, ?)',
                [userId, 'dice', betAmount, win > 0 ? 'win' : 'lose', win]);
            
            res.json({ dice: [dice1, dice2], sum, win, newBalance, message });
        });
    });
});

// Avião (Crash)
app.post('/api/game/crash', (req, res) => {
    const { userId, betAmount, cashoutMultiplier } = req.body;
    
    db.get('SELECT balance FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado.' });
        
        let newBalance = user.balance;
        let win = 0;
        let message = '';
        
        if (cashoutMultiplier > 0) {
            win = betAmount * cashoutMultiplier;
            newBalance = user.balance + win - betAmount;
            message = `💰 Retirada! ${cashoutMultiplier.toFixed(2)}x +R$ ${(win - betAmount).toFixed(2)}`;
        } else {
            message = `💥 Crash! Perdeu R$ ${betAmount.toFixed(2)}`;
        }
        
        db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId], (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao atualizar saldo.' });
            
            db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES (?, ?, ?, ?, ?)',
                [userId, 'crash', betAmount, win > 0 ? 'win' : 'lose', win - betAmount]);
            
            res.json({ newBalance, message, win: win - betAmount });
        });
    });
});

// ==================== ROTAS ADMIN ====================

// Middleware de autenticação admin
const checkAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        return res.status(401).json({ error: 'Não autorizado' });
    }
    
    const base64 = authHeader.split(' ')[1];
    const [email, password] = Buffer.from(base64, 'base64').toString().split(':');
    
    db.get('SELECT * FROM users WHERE email = ? AND password = ? AND status = "Admin"', [email, password], (err, admin) => {
        if (err || !admin) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        req.admin = admin;
        next();
    });
};

// Estatísticas do dashboard
app.get('/api/admin/stats', checkAdmin, (req, res) => {
    db.get('SELECT COUNT(*) as total_users, SUM(balance) as total_balance FROM users', (err, users) => {
        db.get('SELECT COUNT(*) as pending_deposits FROM deposit_requests WHERE status = "Pendente"', (err, deposits) => {
            db.get('SELECT COUNT(*) as pending_withdraws FROM withdraw_requests WHERE status = "Pendente"', (err, withdraws) => {
                res.json({
                    total_users: users.total_users || 0,
                    total_balance: users.total_balance || 0,
                    pending_deposits: deposits.pending_deposits || 0,
                    pending_withdraws: withdraws.pending_withdraws || 0
                });
            });
        });
    });
});

// Listar depósitos pendentes
app.get('/api/admin/deposits', checkAdmin, (req, res) => {
    const sql = `SELECT d.*, u.name FROM deposit_requests d JOIN users u ON d.user_id = u.id WHERE d.status = 'Pendente' ORDER BY d.created_at DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar depósitos.' });
        res.json(rows);
    });
});

// Confirmar depósito
app.post('/api/admin/confirm-deposit/:id', checkAdmin, (req, res) => {
    const { id } = req.params;
    const { amount } = req.body;
    
    db.get('SELECT user_id FROM deposit_requests WHERE id = ?', [id], (err, request) => {
        if (err || !request) return res.status(404).json({ error: 'Depósito não encontrado.' });
        
        db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, request.user_id], (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao creditar saldo.' });
            
            db.run('UPDATE deposit_requests SET status = "Confirmado" WHERE id = ?', [id]);
            res.json({ message: 'Depósito confirmado com sucesso!' });
        });
    });
});

// Rejeitar depósito
app.post('/api/admin/reject-deposit/:id', checkAdmin, (req, res) => {
    const { id } = req.params;
    db.run('UPDATE deposit_requests SET status = "Rejeitado" WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: 'Erro ao rejeitar depósito.' });
        res.json({ message: 'Depósito rejeitado.' });
    });
});

// Listar saques pendentes
app.get('/api/admin/withdraws', checkAdmin, (req, res) => {
    const sql = `SELECT w.*, u.name, u.pix_key as user_pix FROM withdraw_requests w JOIN users u ON w.user_id = u.id WHERE w.status = 'Pendente' ORDER BY w.created_at DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar saques.' });
        res.json(rows);
    });
});

// Aprovar saque
app.post('/api/admin/withdraw/:id/approve', checkAdmin, (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT user_id, amount FROM withdraw_requests WHERE id = ? AND status = "Pendente"', [id], (err, request) => {
        if (err || !request) return res.status(404).json({ error: 'Saque não encontrado.' });
        
        db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [request.amount, request.user_id], (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao debitar saldo.' });
            
            db.run('UPDATE withdraw_requests SET status = "Aprovado" WHERE id = ?', [id]);
            res.json({ message: 'Saque aprovado com sucesso!' });
        });
    });
});

// Rejeitar saque
app.post('/api/admin/withdraw/:id/reject', checkAdmin, (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    
    db.run('UPDATE withdraw_requests SET status = "Rejeitado" WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: 'Erro ao rejeitar saque.' });
        res.json({ message: 'Saque rejeitado.' });
    });
});

// Listar usuários
app.get('/api/admin/users', checkAdmin, (req, res) => {
    db.all('SELECT id, name, email, cpf, phone, pix_key, balance, status, created_at FROM users', [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar usuários.' });
        res.json(rows);
    });
});

// Buscar usuário por ID
app.get('/api/admin/user/:id', checkAdmin, (req, res) => {
    db.get('SELECT id, name, email, cpf, phone, pix_key, balance, status, rtp_individual, affiliate_commission FROM users WHERE id = ?', [req.params.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado.' });
        res.json(user);
    });
});

// Atualizar usuário
app.post('/api/admin/user/:id/update', checkAdmin, (req, res) => {
    const { id } = req.params;
    const { name, email, cpf, phone, pix_key, balance, status } = req.body;
    
    const sql = 'UPDATE users SET name = ?, email = ?, cpf = ?, phone = ?, pix_key = ?, balance = ?, status = ? WHERE id = ?';
    db.run(sql, [name, email, cpf, phone, pix_key, balance, status, id], function(err) {
        if (err) return res.status(500).json({ error: 'Erro ao atualizar usuário.' });
        res.json({ message: 'Usuário atualizado com sucesso!' });
    });
});

// Histórico recente
app.get('/api/admin/recent-history', checkAdmin, (req, res) => {
    const sql = `SELECT h.*, u.name FROM game_history h JOIN users u ON h.user_id = u.id ORDER BY h.created_at DESC LIMIT 50`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar histórico.' });
        res.json(rows);
    });
});

// Buscar configurações
app.get('/api/admin/config', checkAdmin, (req, res) => {
    db.get('SELECT * FROM admin_config WHERE id = 1', [], (err, config) => {
        if (err || !config) return res.status(500).json({ error: 'Erro ao buscar configurações.' });
        res.json(config);
    });
});

// Salvar configurações
app.post('/api/admin/config', checkAdmin, (req, res) => {
    const config = req.body;
    
    const sql = `UPDATE admin_config SET 
        pix_key = ?, min_deposit = ?, bonus_amount = ?, min_withdraw = ?, max_withdraw = ?, withdraw_fee = ?,
        initial_bonus = ?, initial_goal = ?, required_deposit = ?, post_deposit_goal = ?,
        slot_min_bet = ?, dice_min_bet = ?, crash_min_bet = ?, roulette_min_bet = ?, blackjack_min_bet = ?,
        slot_rtp = ?, dice_rtp = ?, crash_rtp = ?, roulette_rtp = ?, blackjack_rtp = ?
        WHERE id = 1`;
    
    db.run(sql, [
        config.pix_key, config.min_deposit, config.bonus_amount, config.min_withdraw, config.max_withdraw, config.withdraw_fee,
        config.initial_bonus, config.initial_goal, config.required_deposit, config.post_deposit_goal,
        config.slot_min_bet, config.dice_min_bet, config.crash_min_bet, config.roulette_min_bet, config.blackjack_min_bet,
        config.slot_rtp, config.dice_rtp, config.crash_rtp, config.roulette_rtp, config.blackjack_rtp
    ], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Erro ao salvar configurações.' });
        }
        res.json({ message: 'Configurações salvas com sucesso!' });
    });
});

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📁 Servindo arquivos de: ${path.join(__dirname, '../frontend')}`);
});
