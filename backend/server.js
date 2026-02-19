const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;

// Armazenar conexões WebSocket
const clients = new Map(); // userId -> WebSocket

// WebSocket para tempo real
wss.on('connection', (ws, req) => {
    console.log('✅ Novo cliente conectado');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'auth' && data.userId) {
                clients.set(data.userId.toString(), ws);
                console.log(`👤 Usuário ${data.userId} autenticado no WebSocket`);
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

// Função para enviar atualização em tempo real
function sendRealTimeUpdate(userId, type, data) {
    const client = clients.get(userId.toString());
    if (client && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type, data }));
    }
}

// Função para enviar para todos os admins
function sendToAllAdmins(type, data) {
    for (let [userId, client] of clients.entries()) {
        if (userId.toString().startsWith('admin')) {
            if (client && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type, data }));
            }
        }
    }
}

// Configurações
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Conecta ao banco de dados SQLite
const db = new sqlite3.Database('./database.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) return console.error('Erro no banco:', err.message);
    console.log('✅ Conectado ao DB SQLite.');
    
    // Cria tabela de usuários (COMPLETA)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        pix_key TEXT,
        cpf TEXT,
        full_name TEXT,
        phone TEXT,
        birth_date TEXT,
        address TEXT,
        city TEXT,
        state TEXT,
        zip_code TEXT,
        balance REAL DEFAULT 0,
        status TEXT DEFAULT 'Pendente',
        total_deposits REAL DEFAULT 0,
        total_withdraws REAL DEFAULT 0,
        total_bets REAL DEFAULT 0,
        total_wins REAL DEFAULT 0,
        total_games INTEGER DEFAULT 0,
        rtp_individual REAL DEFAULT NULL,
        last_login DATETIME,
        last_ip TEXT,
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
        balance_before REAL,
        balance_after REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela de depósitos
    db.run(`CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL,
        bonus_amount REAL DEFAULT 0,
        payment_method TEXT DEFAULT 'PIX',
        transaction_id TEXT,
        status TEXT DEFAULT 'Pendente',
        confirmed_by INTEGER,
        confirmed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela de saques (COMPLETA)
    db.run(`CREATE TABLE IF NOT EXISTS withdraw_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        cpf TEXT,
        pix_key TEXT,
        pix_type TEXT,
        amount REAL,
        fee REAL DEFAULT 0,
        net_amount REAL,
        status TEXT DEFAULT 'Pendente',
        processed_by INTEGER,
        processed_at DATETIME,
        payment_proof TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela de transações financeiras
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT,
        amount REAL,
        balance_before REAL,
        balance_after REAL,
        reference_id INTEGER,
        reference_type TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela de estatísticas da casa
    db.run(`CREATE TABLE IF NOT EXISTS house_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        total_bets REAL DEFAULT 0,
        total_paid REAL DEFAULT 0,
        house_profit REAL DEFAULT 0,
        total_users INTEGER DEFAULT 0,
        total_deposits REAL DEFAULT 0,
        total_withdraws REAL DEFAULT 0,
        active_users INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela de configurações do admin (ATUALIZADA)
    db.run(`CREATE TABLE IF NOT EXISTS admin_config (
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
        slot_rtp REAL DEFAULT 95,
        dice_rtp REAL DEFAULT 95,
        crash_rtp REAL DEFAULT 95,
        slot_volatility TEXT DEFAULT 'medium',
        dice_volatility TEXT DEFAULT 'medium',
        crash_volatility TEXT DEFAULT 'medium',
        site_name TEXT DEFAULT 'Nexus Trade',
        contact_email TEXT DEFAULT 'suporte@nexustrade.com',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (!err) {
            db.get('SELECT * FROM admin_config WHERE id = 1', (err, row) => {
                if (!row) {
                    db.run(`INSERT INTO admin_config 
                        (id, pix_key, min_deposit, bonus_amount, min_withdraw, slot_rtp, dice_rtp, crash_rtp) 
                        VALUES (1, '1c5c21fc-fcbc-4b28-b285-74156c727917', 20, 30, 150, 95, 95, 95)`);
                    console.log('✅ Configurações iniciais criadas');
                }
            });
            
            // Inicializa estatísticas da casa
            db.run(`INSERT OR IGNORE INTO house_stats (id, total_bets, total_paid, house_profit) 
                    VALUES (1, 0, 0, 0)`);
            
            // Cria usuário admin padrão
            const saltRounds = 10;
            const adminPass = bcrypt.hashSync('admin123', saltRounds);
            db.run(`INSERT OR IGNORE INTO users 
                (name, email, password, status, balance) 
                VALUES ('Administrador', 'admin@nexus.com', ?, 'Admin', 0)`, [adminPass]);
        }
    });
});

// ===== FUNÇÕES AUXILIARES =====

// Registrar transação
function registerTransaction(userId, type, amount, balanceBefore, balanceAfter, referenceId, referenceType, description) {
    db.run(`INSERT INTO transactions 
        (user_id, type, amount, balance_before, balance_after, reference_id, reference_type, description) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, type, amount, balanceBefore, balanceAfter, referenceId, referenceType, description]);
}

// Atualizar estatísticas da casa
function updateHouseStats(betAmount, winAmount) {
    db.run(`UPDATE house_stats SET 
        total_bets = total_bets + ?,
        total_paid = total_paid + ?,
        house_profit = total_bets - total_paid,
        updated_at = CURRENT_TIMESTAMP
        WHERE id = 1`, [betAmount, winAmount]);
}

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
    const { name, email, password, pixKey, cpf, phone, birthDate } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(`INSERT INTO users 
            (name, email, password, pix_key, cpf, phone, birth_date, full_name) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, email, hashedPassword, pixKey || '', cpf || '', phone || '', birthDate || '', name],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Email já cadastrado' });
                    }
                    return res.status(500).json({ error: 'Erro no cadastro' });
                }
                
                // Atualizar estatísticas
                db.run('UPDATE house_stats SET total_users = total_users + 1 WHERE id = 1');
                
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
        
        // Atualizar último login
        db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
        
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
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.get('SELECT balance, name, email FROM users WHERE id = ?', [userId], (err, user) => {
            if (err || !user) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }
            
            db.run(`INSERT INTO deposits (user_id, amount, transaction_id) 
                    VALUES (?, ?, ?)`,
                [userId, amount, 'DEP' + Date.now()],
                function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Erro ao solicitar depósito' });
                    }
                    
                    db.run('COMMIT');
                    
                    // Notificar admins
                    sendToAllAdmins('new_deposit', {
                        id: this.lastID,
                        user: { name: user.name, email: user.email },
                        amount: amount
                    });
                    
                    res.json({ 
                        message: '✅ Depósito solicitado! Aguarde confirmação.',
                        depositId: this.lastID
                    });
                }
            );
        });
    });
});

// ===== ROTAS DE SAQUE =====
app.post('/api/request-withdraw', (req, res) => {
    const { userId, amount, name, cpf, pixKey, pixType } = req.body;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.get('SELECT balance, name, email FROM users WHERE id = ?', [userId], (err, user) => {
            if (err || !user) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }
            
            if (user.balance < amount) {
                db.run('ROLLBACK');
                return res.status(400).json({ error: 'Saldo insuficiente' });
            }
            
            // Verificar saque mínimo
            db.get('SELECT min_withdraw, withdraw_fee FROM admin_config WHERE id = 1', (err, config) => {
                if (amount < config.min_withdraw) {
                    db.run('ROLLBACK');
                    return res.status(400).json({ error: `Saque mínimo: R$ ${config.min_withdraw}` });
                }
                
                const fee = config.withdraw_fee || 0;
                const netAmount = amount - fee;
                
                // Registrar saque
                db.run(`INSERT INTO withdraw_requests 
                    (user_id, name, cpf, pix_key, pix_type, amount, fee, net_amount) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [userId, name || user.name, cpf, pixKey, pixType || 'CPF', amount, fee, netAmount],
                    function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Erro ao solicitar saque' });
                        }
                        
                        db.run('COMMIT');
                        
                        // Notificar admins
                        sendToAllAdmins('new_withdraw', {
                            id: this.lastID,
                            user: { name: user.name, email: user.email },
                            amount: amount,
                            netAmount: netAmount
                        });
                        
                        res.json({ 
                            message: '✅ Saque solicitado! Aguarde aprovação.',
                            withdrawId: this.lastID
                        });
                    }
                );
            });
        });
    });
});

// ===== ROTAS DE JOGOS (ATUALIZADAS COM CONFIGURAÇÕES) =====

// Rota para jogar slots (COM CONFIGURAÇÕES DO PAINEL)
app.post('/api/game/slot', (req, res) => {
    const { userId, betAmount } = req.body;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // Buscar dados do usuário E as configurações atuais
        db.get(`
            SELECT u.balance, u.status, u.rtp_individual, 
                   c.slot_rtp as global_rtp, 
                   c.slot_volatility,
                   c.slot_min_bet
            FROM users u 
            CROSS JOIN admin_config c
            WHERE u.id = ?
        `, [userId], (err, data) => {
            if (err || !data) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }
            
            const user = data;
            
            // Verificar aposta mínima (vinda da config)
            if (betAmount < user.slot_min_bet) {
                db.run('ROLLBACK');
                return res.status(400).json({ error: `Aposta mínima: R$ ${user.slot_min_bet}` });
            }
            
            if (user.status === 'Pendente') {
                db.run('ROLLBACK');
                return res.status(400).json({ error: 'Usuário precisa ativar conta' });
            }
            
            if (user.balance < betAmount) {
                db.run('ROLLBACK');
                return res.status(400).json({ error: 'Saldo insuficiente' });
            }
            
            // USAR RTP das configurações
            const rtpToUse = user.rtp_individual || user.global_rtp;
            
            const symbols = ['🍒', '💎', '7️⃣', '⭐'];
            const multipliers = [2, 5, 10, 20];
            
            // Ajustar volatilidade baseado na config
            let winMultiplier;
            switch(user.slot_volatility) {
                case 'low':
                    winMultiplier = 1.2 + (Math.random() * 0.5);
                    break;
                case 'high':
                    winMultiplier = 3 + (Math.random() * 10);
                    break;
                default: // medium
                    winMultiplier = 2 + (Math.random() * 3);
            }
            
            const winChance = rtpToUse / 100;
            
            let r1, r2, r3;
            let winAmount = 0;
            let message = '';
            
            if (Math.random() < winChance) {
                if (Math.random() < 0.3) {
                    const symbolIndex = Math.floor(Math.random() * symbols.length);
                    r1 = r2 = r3 = symbolIndex;
                    winAmount = betAmount * multipliers[symbolIndex];
                    message = `🎉 GRANDE VITÓRIA! +R$ ${winAmount.toFixed(2)}`;
                } else {
                    const symbolIndex = Math.floor(Math.random() * symbols.length);
                    r1 = r2 = symbolIndex;
                    r3 = (symbolIndex + 1) % symbols.length;
                    winAmount = betAmount * 0.5;
                    message = `👍 PEQUENA VITÓRIA! +R$ ${winAmount.toFixed(2)}`;
                }
            } else {
                r1 = Math.floor(Math.random() * symbols.length);
                r2 = (r1 + 1) % symbols.length;
                r3 = (r2 + 1) % symbols.length;
                winAmount = 0;
                message = `😢 PERDEU! -R$ ${betAmount.toFixed(2)}`;
            }
            
            const balanceBefore = user.balance;
            const balanceAfter = balanceBefore - betAmount + winAmount;
            
            db.run('UPDATE users SET balance = ? WHERE id = ?', [balanceAfter, userId]);
            db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES (?, ?, ?, ?, ?)',
                [userId, 'slot', betAmount, message, winAmount]);
            
            db.run('COMMIT');
            
            // Enviar atualização em tempo real
            sendRealTimeUpdate(userId, 'balance_update', { balance: balanceAfter });
            
            res.json({
                success: true,
                symbols: [symbols[r1], symbols[r2], symbols[r3]],
                win: winAmount,
                newBalance: balanceAfter,
                message: message
            });
        });
    });
});

// Rota para jogar dados (COM CONFIGURAÇÕES)
app.post('/api/game/dice', (req, res) => {
    const { userId, betAmount, betType } = req.body;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.get(`
            SELECT u.balance, u.status, 
                   c.dice_rtp as global_rtp,
                   c.dice_min_bet
            FROM users u 
            CROSS JOIN admin_config c
            WHERE u.id = ?
        `, [userId], (err, data) => {
            if (err || !data) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }
            
            const user = data;
            
            if (betAmount < user.dice_min_bet) {
                db.run('ROLLBACK');
                return res.status(400).json({ error: `Aposta mínima: R$ ${user.dice_min_bet}` });
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
            
            const balanceBefore = user.balance;
            const balanceAfter = balanceBefore - betAmount + winAmount;
            
            db.run('UPDATE users SET balance = ? WHERE id = ?', [balanceAfter, userId]);
            db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES (?, ?, ?, ?, ?)',
                [userId, 'dice', betAmount, message, winAmount]);
            
            db.run('COMMIT');
            
            sendRealTimeUpdate(userId, 'balance_update', { balance: balanceAfter });
            
            res.json({
                success: true,
                dice: [d1, d2],
                sum: sum,
                win: winAmount,
                newBalance: balanceAfter,
                message: message
            });
        });
    });
});

// Rota para aviãozinho (COM CONFIGURAÇÕES)
app.post('/api/game/crash', (req, res) => {
    const { userId, betAmount, cashoutMultiplier } = req.body;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.get(`
            SELECT u.balance, 
                   c.crash_min_bet
            FROM users u 
            CROSS JOIN admin_config c
            WHERE u.id = ?
        `, [userId], (err, data) => {
            if (err || !data) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }
            
            const user = data;
            
            if (betAmount < user.crash_min_bet) {
                db.run('ROLLBACK');
                return res.status(400).json({ error: `Aposta mínima: R$ ${user.crash_min_bet}` });
            }
            
            const winAmount = betAmount * cashoutMultiplier;
            const balanceAfter = user.balance + winAmount;
            
            let message = '';
            if (cashoutMultiplier > 0) {
                message = `💰 RETIRADA! ${cashoutMultiplier.toFixed(2)}x +R$ ${winAmount.toFixed(2)}`;
            } else {
                message = `💥 CRASH! Perdeu R$ ${betAmount.toFixed(2)}`;
            }
            
            db.run('UPDATE users SET balance = ? WHERE id = ?', [balanceAfter, userId]);
            db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES (?, ?, ?, ?, ?)',
                [userId, 'crash', betAmount, message, winAmount]);
            
            db.run('COMMIT');
            
            sendRealTimeUpdate(userId, 'balance_update', { balance: balanceAfter });
            
            res.json({
                success: true,
                newBalance: balanceAfter,
                message: message
            });
        });
    });
});

// ===== ROTAS DO ADMIN =====

// Middleware de autenticação do admin
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
    `, [], (err, stats) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar estatísticas' });
        res.json(stats);
    });
});

// Buscar todos os usuários
app.get('/api/admin/users', checkAdmin, (req, res) => {
    db.all(`SELECT 
        id, name, email, pix_key, cpf, phone, birth_date,
        balance, status, total_deposits, total_withdraws,
        total_bets, total_wins, total_games, rtp_individual,
        last_login, created_at
        FROM users 
        WHERE status != 'Admin'
        ORDER BY id DESC`, [], (err, users) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar usuários' });
        res.json(users);
    });
});

// Buscar detalhes de um usuário
app.get('/api/admin/user/:id', checkAdmin, (req, res) => {
    const { id } = req.params;
    
    db.get(`SELECT * FROM users WHERE id = ?`, [id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
        delete user.password;
        res.json(user);
    });
});

// Listar depósitos pendentes
app.get('/api/admin/deposits', checkAdmin, (req, res) => {
    db.all(`SELECT 
        d.*, u.name, u.email, u.balance
        FROM deposits d
        JOIN users u ON d.user_id = u.id
        WHERE d.status = 'Pendente'
        ORDER BY d.created_at DESC`, [], (err, deposits) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar depósitos' });
        res.json(deposits);
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
            
            db.get('SELECT balance FROM users WHERE id = ?', [deposit.user_id], (err, user) => {
                const balanceBefore = user.balance;
                const balanceAfter = user.balance + amount;
                
                db.run(`UPDATE deposits SET 
                    status = 'Confirmado',
                    confirmed_by = ?,
                    confirmed_at = CURRENT_TIMESTAMP
                    WHERE id = ?`, [req.admin.id, id]);
                
                db.run(`UPDATE users SET 
                    balance = ?,
                    total_deposits = total_deposits + ?,
                    status = 'Ativo'
                    WHERE id = ?`, [balanceAfter, amount, deposit.user_id]);
                
                db.run('COMMIT');
                
                // Notificar usuário
                sendRealTimeUpdate(deposit.user_id, 'deposit_confirmed', {
                    id: id,
                    amount: amount,
                    newBalance: balanceAfter
                });
                
                res.json({ message: 'Depósito confirmado!' });
            });
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
    db.all(`SELECT 
        w.*, u.name as user_name, u.email, u.balance
        FROM withdraw_requests w
        JOIN users u ON w.user_id = u.id
        WHERE w.status = 'Pendente'
        ORDER BY w.created_at DESC`, [], (err, withdraws) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar saques' });
        res.json(withdraws);
    });
});

// Aprovar saque
app.post('/api/admin/withdraw/:id/approve', checkAdmin, (req, res) => {
    const { id } = req.params;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.get(`SELECT * FROM withdraw_requests WHERE id = ?`, [id], (err, withdraw) => {
            if (err || !withdraw) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Saque não encontrado' });
            }
            
            db.get('SELECT balance FROM users WHERE id = ?', [withdraw.user_id], (err, user) => {
                if (err || !user) {
                    db.run('ROLLBACK');
                    return res.status(404).json({ error: 'Usuário não encontrado' });
                }
                
                if (user.balance < withdraw.amount) {
                    db.run('ROLLBACK');
                    return res.status(400).json({ error: 'Saldo insuficiente' });
                }
                
                const balanceBefore = user.balance;
                const balanceAfter = user.balance - withdraw.amount;
                
                db.run(`UPDATE withdraw_requests SET 
                    status = 'Aprovado',
                    processed_by = ?,
                    processed_at = CURRENT_TIMESTAMP
                    WHERE id = ?`, [req.admin.id, id]);
                
                db.run(`UPDATE users SET 
                    balance = ?,
                    total_withdraws = total_withdraws + ?
                    WHERE id = ?`, [balanceAfter, withdraw.amount, withdraw.user_id]);
                
                db.run('COMMIT');
                
                sendRealTimeUpdate(withdraw.user_id, 'withdraw_approved', {
                    id: id,
                    amount: withdraw.amount,
                    newBalance: balanceAfter
                });
                
                res.json({ message: 'Saque aprovado!' });
            });
        });
    });
});

// Rejeitar saque
app.post('/api/admin/withdraw/:id/reject', checkAdmin, (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    
    db.run(`UPDATE withdraw_requests SET 
        status = 'Rejeitado',
        processed_by = ?,
        processed_at = CURRENT_TIMESTAMP,
        notes = ?
        WHERE id = ?`, [req.admin.id, reason, id], function(err) {
        if (err) return res.status(500).json({ error: 'Erro ao rejeitar saque' });
        
        db.get('SELECT user_id, amount FROM withdraw_requests WHERE id = ?', [id], (err, withdraw) => {
            sendRealTimeUpdate(withdraw.user_id, 'withdraw_rejected', {
                id: id,
                amount: withdraw.amount,
                reason: reason
            });
        });
        
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
        LIMIT 50
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

// Atualizar configurações (COM FEEDBACK EM TEMPO REAL)
app.post('/api/admin/config', checkAdmin, (req, res) => {
    const {
        pix_key,
        min_deposit,
        bonus_amount,
        min_withdraw,
        max_withdraw,
        withdraw_fee,
        slot_min_bet,
        dice_min_bet,
        crash_min_bet,
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
            max_withdraw = ?,
            withdraw_fee = ?,
            slot_min_bet = ?,
            dice_min_bet = ?,
            crash_min_bet = ?,
            slot_rtp = ?,
            dice_rtp = ?,
            crash_rtp = ?,
            slot_volatility = ?,
            dice_volatility = ?,
            crash_volatility = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
    `,
        [pix_key, min_deposit, bonus_amount, min_withdraw, max_withdraw, withdraw_fee,
         slot_min_bet, dice_min_bet, crash_min_bet,
         slot_rtp, dice_rtp, crash_rtp, 
         slot_volatility, dice_volatility, crash_volatility],
        function(err) {
            if (err) {
                console.error('Erro ao salvar config:', err);
                return res.status(500).json({ error: 'Erro ao atualizar configurações' });
            }
            
            // Buscar as configurações atualizadas para enviar
            db.get('SELECT * FROM admin_config WHERE id = 1', (err, config) => {
                if (!err && config) {
                    // Enviar para todos os admins em tempo real
                    sendToAllAdmins('config_updated', config);
                }
            });
            
            res.json({ 
                success: true,
                message: '✅ Configurações atualizadas com sucesso!' 
            });
        }
    );
});

// Buscar dados do usuário
app.get('/api/user/:id', (req, res) => {
    db.get(`SELECT 
        id, name, email, pix_key, cpf, phone, birth_date,
        balance, status, total_deposits, total_withdraws,
        total_bets, total_wins, total_games
        FROM users WHERE id = ?`,
        [req.params.id],
        (err, user) => {
            if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
            res.json(user);
        }
    );
});

// Buscar histórico do usuário
app.get('/api/user/:id/history', (req, res) => {
    db.all(`SELECT * FROM game_history 
        WHERE user_id = ? 
        ORDER BY created_at DESC 
        LIMIT 20`,
        [req.params.id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: 'Erro ao buscar histórico' });
            res.json(rows);
        }
    );
});

// Rota principal
app.get('/', (req, res) => {
    res.redirect('/login');
});

// Inicia o servidor
server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📱 Login: http://localhost:${PORT}/login`);
    console.log(`👤 Cadastro: http://localhost:${PORT}/cadastro`);
    console.log(`🎮 Jogos: http://localhost:${PORT}/dashboard`);
    console.log(`⚙️ Admin: http://localhost:${PORT}/admin`);
    console.log(`🔌 WebSocket ativo para tempo real`);
});