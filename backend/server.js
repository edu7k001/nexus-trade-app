const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
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
const clients = new Map();

// WebSocket
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

// Funções auxiliares WebSocket
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

// Configurações do Express
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Banco de dados SQLite
const db = new sqlite3.Database('./database.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) return console.error('Erro no banco:', err.message);
    console.log('✅ Conectado ao DB SQLite.');

    db.serialize(() => {
        // Tabela de usuários (com campos para afiliados)
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            last_login DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabela de comissões de afiliados
        db.run(`CREATE TABLE IF NOT EXISTS affiliate_commissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            affiliate_id INTEGER,
            referred_id INTEGER,
            amount REAL,
            type TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabela de histórico de jogos
        db.run(`CREATE TABLE IF NOT EXISTS game_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            game TEXT,
            bet_amount REAL,
            result TEXT,
            win_amount REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabela de depósitos
        db.run(`CREATE TABLE IF NOT EXISTS deposits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            amount REAL,
            status TEXT DEFAULT 'Pendente',
            confirmed_by INTEGER,
            confirmed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabela de saques
        db.run(`CREATE TABLE IF NOT EXISTS withdraw_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT,
            cpf TEXT,
            pix_key TEXT,
            amount REAL,
            status TEXT DEFAULT 'Pendente',
            processed_by INTEGER,
            processed_at DATETIME,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabela de transações
        db.run(`CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            type TEXT,
            amount REAL,
            balance_before REAL,
            balance_after REAL,
            reference_id INTEGER,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabela de estatísticas da casa
        db.run(`CREATE TABLE IF NOT EXISTS house_stats (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            total_bets REAL DEFAULT 0,
            total_paid REAL DEFAULT 0,
            total_users INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabela de configurações do admin
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
            primary_color TEXT DEFAULT '#ffd700',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Inserções iniciais
        db.get('SELECT * FROM admin_config WHERE id = 1', (err, row) => {
            if (!row) {
                db.run(`INSERT INTO admin_config 
                    (id, pix_key, min_deposit, bonus_amount, min_withdraw) 
                    VALUES (1, '1c5c21fc-fcbc-4b28-b285-74156c727917', 20, 30, 150)`);
            }
        });

        db.run(`INSERT OR IGNORE INTO house_stats (id, total_bets, total_paid) VALUES (1, 0, 0)`);

        const adminPass = bcrypt.hashSync('admin123', 10);
        db.run(`INSERT OR IGNORE INTO users (name, email, password, status) 
                VALUES ('Administrador', 'admin@nexus.com', ?, 'Admin')`, [adminPass]);

        console.log('✅ Banco de dados inicializado com sucesso.');
    });
});

// ===== FUNÇÕES AUXILIARES =====
function gerarCodigoAfiliado() {
    return 'NEX' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

// ===== ROTA DO QR CODE =====
app.get('/api/pix-qrcode', (req, res) => {
    const imagePath = path.join(__dirname, '../frontend/images/pix-nexus.png');
    if (fs.existsSync(imagePath)) {
        db.get('SELECT pix_key FROM admin_config WHERE id = 1', (err, row) => {
            if (err || !row) return res.status(500).json({ error: 'Erro ao buscar chave PIX' });
            res.json({ success: true, qrcode: '/images/pix-nexus.png', pixKey: row.pix_key });
        });
    } else {
        res.status(404).json({ error: 'Imagem do QR Code não encontrada' });
    }
});

// ===== ROTAS DE AUTENTICAÇÃO =====
app.get('/cadastro', (req, res) => res.sendFile(path.join(__dirname, '../frontend/cadastro.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../frontend/login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../frontend/dashboard.html')));

app.post('/api/register', async (req, res) => {
    const { name, email, password, pixKey, cpf, phone, ref } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const affiliateCode = gerarCodigoAfiliado();
        let referredBy = null;
        if (ref) {
            const userRef = await new Promise((resolve) => {
                db.get('SELECT id FROM users WHERE affiliate_code = ?', [ref], (err, row) => resolve(row));
            });
            if (userRef) referredBy = userRef.id;
        }
        db.run(
            `INSERT INTO users (name, email, password, pix_key, cpf, phone, affiliate_code, referred_by) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, email, hashedPassword, pixKey || '', cpf || '', phone || '', affiliateCode, referredBy],
            function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email já cadastrado' });
                    return res.status(500).json({ error: 'Erro no cadastro' });
                }
                db.run('UPDATE house_stats SET total_users = total_users + 1 WHERE id = 1');
                res.status(201).json({ id: this.lastID, message: 'Cadastro realizado!' });
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'Erro interno' });
    }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Email ou senha inválidos' });
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(401).json({ error: 'Email ou senha inválidos' });
        db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
        delete user.password;
        res.json({ user, redirect: user.status === 'Admin' ? '/admin' : '/dashboard' });
    });
});

// ===== ROTAS DE DEPÓSITO =====
app.post('/api/request-deposit', (req, res) => {
    const { userId, amount } = req.body;
    db.get('SELECT name, email FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
        db.run(`INSERT INTO deposits (user_id, amount) VALUES (?, ?)`, [userId, amount], function (err) {
            if (err) return res.status(500).json({ error: 'Erro ao solicitar depósito' });
            sendToAllAdmins('new_deposit', { id: this.lastID, user, amount });
            res.json({ message: '✅ Depósito solicitado!', depositId: this.lastID });
        });
    });
});

// ===== ROTAS DE SAQUE =====
app.post('/api/request-withdraw', (req, res) => {
    const { userId, amount, name, cpf, pixKey } = req.body;
    db.get('SELECT balance, name, email FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
        if (user.balance < amount) return res.status(400).json({ error: 'Saldo insuficiente' });
        db.get('SELECT min_withdraw FROM admin_config WHERE id = 1', (err, config) => {
            if (amount < config.min_withdraw) {
                return res.status(400).json({ error: `Saque mínimo: R$ ${config.min_withdraw}` });
            }
            db.run(`INSERT INTO withdraw_requests (user_id, name, cpf, pix_key, amount) VALUES (?, ?, ?, ?, ?)`,
                [userId, name || user.name, cpf, pixKey, amount], function (err) {
                    if (err) return res.status(500).json({ error: 'Erro ao solicitar saque' });
                    sendToAllAdmins('new_withdraw', { id: this.lastID, user, amount });
                    res.json({ message: '✅ Saque solicitado!', withdrawId: this.lastID });
                });
        });
    });
});

// ===== ROTAS DE JOGOS =====

// Função para processar comissão de afiliado
function processarComissaoAfiliado(userId, amount, type) {
    db.get('SELECT referred_by FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user || !user.referred_by) return;
        const affiliateId = user.referred_by;
        db.get('SELECT affiliate_commission FROM users WHERE id = ?', [affiliateId], (err, aff) => {
            if (err || !aff) return;
            const commission = (amount * aff.affiliate_commission) / 100;
            db.run('UPDATE users SET affiliate_balance = affiliate_balance + ? WHERE id = ?', [commission, affiliateId]);
            db.run(`INSERT INTO affiliate_commissions (affiliate_id, referred_id, amount, type) VALUES (?, ?, ?, ?)`,
                [affiliateId, userId, commission, type]);
            sendRealTimeUpdate(affiliateId, 'affiliate_commission', { amount: commission, type });
        });
    });
}

// Slot
app.post('/api/game/slot', (req, res) => {
    const { userId, betAmount } = req.body;
    db.get(`
        SELECT u.balance, u.status, u.rtp_individual,
               c.slot_rtp as global_rtp, c.slot_min_bet
        FROM users u CROSS JOIN admin_config c WHERE u.id = ?
    `, [userId], (err, data) => {
        if (err || !data) return res.status(404).json({ error: 'Usuário não encontrado' });
        if (betAmount < data.slot_min_bet) {
            return res.status(400).json({ error: `Aposta mínima: R$ ${data.slot_min_bet}` });
        }
        if (data.status === 'Pendente') {
            return res.status(400).json({ error: 'Ative sua conta com um depósito' });
        }
        if (data.balance < betAmount) {
            return res.status(400).json({ error: 'Saldo insuficiente' });
        }

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
        db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);
        db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES (?, ?, ?, ?, ?)',
            [userId, 'slot', betAmount, message, winAmount]);

        if (winAmount === 0) processarComissaoAfiliado(userId, betAmount, 'bet_loss');

        sendRealTimeUpdate(userId, 'balance_update', { balance: newBalance });
        res.json({ success: true, symbols: [symbols[r1], symbols[r2], symbols[r3]], win: winAmount, newBalance, message });
    });
});

// Dados
app.post('/api/game/dice', (req, res) => {
    const { userId, betAmount, betType } = req.body;
    db.get(`
        SELECT u.balance, u.status, c.dice_min_bet
        FROM users u CROSS JOIN admin_config c WHERE u.id = ?
    `, [userId], (err, data) => {
        if (err || !data) return res.status(404).json({ error: 'Usuário não encontrado' });
        if (betAmount < data.dice_min_bet) {
            return res.status(400).json({ error: `Aposta mínima: R$ ${data.dice_min_bet}` });
        }
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
        db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);
        db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES (?, ?, ?, ?, ?)',
            [userId, 'dice', betAmount, message, winAmount]);

        if (winAmount === 0) processarComissaoAfiliado(userId, betAmount, 'bet_loss');

        sendRealTimeUpdate(userId, 'balance_update', { balance: newBalance });
        res.json({ success: true, dice: [d1, d2], sum, win: winAmount, newBalance, message });
    });
});

// Aviãozinho (crash)
app.post('/api/game/crash', (req, res) => {
    const { userId, betAmount, cashoutMultiplier } = req.body;
    db.get(`
        SELECT u.balance, c.crash_min_bet
        FROM users u CROSS JOIN admin_config c WHERE u.id = ?
    `, [userId], (err, data) => {
        if (err || !data) return res.status(404).json({ error: 'Usuário não encontrado' });
        if (betAmount < data.crash_min_bet) {
            return res.status(400).json({ error: `Aposta mínima: R$ ${data.crash_min_bet}` });
        }

        const winAmount = betAmount * (cashoutMultiplier || 0);
        const newBalance = data.balance + winAmount; // A aposta já foi deduzida no frontend
        let message = '';
        if (cashoutMultiplier > 0) {
            message = `💰 RETIRADA! ${cashoutMultiplier.toFixed(2)}x +R$ ${winAmount.toFixed(2)}`;
        } else {
            message = `💥 CRASH! Perdeu R$ ${betAmount.toFixed(2)}`;
        }

        db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);
        db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES (?, ?, ?, ?, ?)',
            [userId, 'crash', betAmount, message, winAmount]);

        if (winAmount === 0) processarComissaoAfiliado(userId, betAmount, 'bet_loss');

        sendRealTimeUpdate(userId, 'balance_update', { balance: newBalance });
        res.json({ success: true, newBalance, message });
    });
});

// Roleta
app.post('/api/game/roulette', (req, res) => {
    const { userId, betAmount, betType, betValue } = req.body;
    db.get(`
        SELECT u.balance, u.status, c.roulette_min_bet
        FROM users u CROSS JOIN admin_config c WHERE u.id = ?
    `, [userId], (err, data) => {
        if (err || !data) return res.status(404).json({ error: 'Usuário não encontrado' });
        if (betAmount < data.roulette_min_bet) {
            return res.status(400).json({ error: `Aposta mínima: R$ ${data.roulette_min_bet}` });
        }
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
        db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);
        db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES (?, ?, ?, ?, ?)',
            [userId, 'roulette', betAmount, message, winAmount]);

        if (winAmount === 0) processarComissaoAfiliado(userId, betAmount, 'bet_loss');

        sendRealTimeUpdate(userId, 'balance_update', { balance: newBalance });
        res.json({ success: true, result, color, win: winAmount, newBalance, message });
    });
});

// Blackjack (simplificado)
app.post('/api/game/blackjack', (req, res) => {
    const { userId, betAmount, action } = req.body;
    db.get(`
        SELECT u.balance, u.status, c.blackjack_min_bet
        FROM users u CROSS JOIN admin_config c WHERE u.id = ?
    `, [userId], (err, data) => {
        if (err || !data) return res.status(404).json({ error: 'Usuário não encontrado' });
        if (betAmount < data.blackjack_min_bet) {
            return res.status(400).json({ error: `Aposta mínima: R$ ${data.blackjack_min_bet}` });
        }
        if (data.balance < betAmount) return res.status(400).json({ error: 'Saldo insuficiente' });

        // Lógica simplificada: dealer sempre ganha a menos que jogador tenha 21
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
        db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);
        db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES (?, ?, ?, ?, ?)',
            [userId, 'blackjack', betAmount, message, winAmount]);

        if (winAmount === 0) processarComissaoAfiliado(userId, betAmount, 'bet_loss');

        sendRealTimeUpdate(userId, 'balance_update', { balance: newBalance });
        res.json({ success: true, playerCards: [playerCard1, playerCard2], playerSum, dealerCard, win: winAmount, newBalance, message });
    });
});

// ===== ROTAS DE AFILIADOS =====
app.get('/api/affiliate/stats/:userId', (req, res) => {
    const userId = req.params.userId;
    db.get(`SELECT affiliate_code, affiliate_balance, affiliate_commission FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
        db.all(`SELECT COUNT(*) as total_refs FROM users WHERE referred_by = ?`, [userId], (err, refs) => {
            db.all(`SELECT SUM(amount) as total_comissoes FROM affiliate_commissions WHERE affiliate_id = ? AND status = 'pending'`, [userId], (err, com) => {
                res.json({
                    code: user.affiliate_code,
                    balance: user.affiliate_balance,
                    commission: user.affiliate_commission,
                    totalRefs: refs[0]?.total_refs || 0,
                    totalCommissions: com[0]?.total_comissoes || 0
                });
            });
        });
    });
});

// ===== ROTAS DO ADMIN =====
const checkAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        return res.status(401).json({ error: 'Não autorizado' });
    }
    try {
        const base64 = authHeader.split(' ')[1];
        const credentials = Buffer.from(base64, 'base64').toString('ascii');
        const [email, password] = credentials.split(':');
        db.get('SELECT * FROM users WHERE email = ? AND status = "Admin"', [email], async (err, admin) => {
            if (err || !admin) return res.status(401).json({ error: 'Não autorizado' });
            const valid = await bcrypt.compare(password, admin.password);
            if (!valid) return res.status(401).json({ error: 'Não autorizado' });
            req.admin = admin;
            next();
        });
    } catch (error) {
        return res.status(401).json({ error: 'Não autorizado' });
    }
};

// Estatísticas
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

// Listar usuários
app.get('/api/admin/users', checkAdmin, (req, res) => {
    db.all(`SELECT id, name, email, pix_key, cpf, phone, balance, status,
                   total_deposits, total_withdraws, total_bets, total_wins, rtp_individual,
                   affiliate_code, referred_by, affiliate_balance, affiliate_commission
            FROM users WHERE status != 'Admin' ORDER BY id DESC`, [], (err, users) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar usuários' });
        res.json(users);
    });
});

// Buscar usuário por ID
app.get('/api/admin/user/:id', checkAdmin, (req, res) => {
    db.get(`SELECT * FROM users WHERE id = ?`, [req.params.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
        delete user.password;
        res.json(user);
    });
});

// Atualizar usuário
app.post('/api/admin/user/:id/update', checkAdmin, (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const allowedFields = ['name', 'email', 'cpf', 'phone', 'pix_key', 'balance', 'status', 'rtp_individual', 'affiliate_commission'];
    const fields = [], values = [];
    Object.keys(updates).forEach(key => {
        if (allowedFields.includes(key)) {
            fields.push(`${key} = ?`);
            values.push(updates[key]);
        }
    });
    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo válido' });
    values.push(id);
    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    db.run(sql, values, function(err) {
        if (err) {
            console.error('Erro ao atualizar:', err);
            return res.status(500).json({ error: 'Erro ao atualizar' });
        }
        if (this.changes === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
        sendRealTimeUpdate(id, 'profile_update', updates);
        res.json({ success: true, message: 'Usuário atualizado!' });
    });
});

// Depósitos pendentes
app.get('/api/admin/deposits', checkAdmin, (req, res) => {
    db.all(`SELECT d.*, u.name, u.email FROM deposits d
            JOIN users u ON d.user_id = u.id
            WHERE d.status = 'Pendente' ORDER BY d.created_at DESC`, [], (err, deposits) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar depósitos' });
        res.json(deposits);
    });
});

// Confirmar depósito (com bônus e comissão de afiliado)
app.post('/api/admin/confirm-deposit/:id', checkAdmin, (req, res) => {
    const { id } = req.params;
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Valor inválido' });
    const valor = parseFloat(amount);
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.get('SELECT user_id, status FROM deposits WHERE id = ?', [id], (err, deposit) => {
            if (err || !deposit) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Depósito não encontrado' });
            }
            if (deposit.status !== 'Pendente') {
                db.run('ROLLBACK');
                return res.status(400).json({ error: 'Depósito já processado' });
            }
            db.get('SELECT balance, referred_by FROM users WHERE id = ?', [deposit.user_id], (err, user) => {
                if (err || !user) {
                    db.run('ROLLBACK');
                    return res.status(404).json({ error: 'Usuário não encontrado' });
                }
                const balanceBefore = user.balance;
                const balanceAfter = user.balance + valor;
                db.run('UPDATE deposits SET status = "Confirmado", confirmed_by = ?, confirmed_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [req.admin.id, id]);
                db.run('UPDATE users SET balance = ?, total_deposits = total_deposits + ?, status = "Ativo" WHERE id = ?',
                    [balanceAfter, valor, deposit.user_id], function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Erro ao creditar' });
                        }
                        // Processar comissão de afiliado sobre depósito
                        if (user.referred_by) {
                            db.get('SELECT affiliate_commission FROM users WHERE id = ?', [user.referred_by], (err, aff) => {
                                if (!err && aff) {
                                    const commission = (valor * aff.affiliate_commission) / 100;
                                    db.run('UPDATE users SET affiliate_balance = affiliate_balance + ? WHERE id = ?', [commission, user.referred_by]);
                                    db.run(`INSERT INTO affiliate_commissions (affiliate_id, referred_id, amount, type, status) VALUES (?, ?, ?, 'deposit', 'pending')`,
                                        [user.referred_by, deposit.user_id, commission]);
                                    sendRealTimeUpdate(user.referred_by, 'affiliate_commission', { amount: commission, type: 'deposit' });
                                }
                            });
                        }
                        db.run('COMMIT');
                        sendRealTimeUpdate(deposit.user_id, 'deposit_confirmed', { amount: valor, newBalance: balanceAfter });
                        res.json({ success: true, message: '✅ Depósito confirmado!' });
                    });
            });
        });
    });
});

// Rejeitar depósito
app.post('/api/admin/reject-deposit/:id', checkAdmin, (req, res) => {
    db.run('UPDATE deposits SET status = "Rejeitado" WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: 'Erro ao rejeitar' });
        res.json({ message: 'Depósito rejeitado' });
    });
});

// Saques pendentes
app.get('/api/admin/withdraws', checkAdmin, (req, res) => {
    db.all(`SELECT w.*, u.name as user_name, u.email FROM withdraw_requests w
            JOIN users u ON w.user_id = u.id
            WHERE w.status = 'Pendente' ORDER BY w.created_at DESC`, [], (err, withdraws) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar saques' });
        res.json(withdraws);
    });
});

// Aprovar saque
app.post('/api/admin/withdraw/:id/approve', checkAdmin, (req, res) => {
    const { id } = req.params;
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.get('SELECT user_id, amount FROM withdraw_requests WHERE id = ? AND status = "Pendente"', [id], (err, withdraw) => {
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
                const balanceAfter = user.balance - withdraw.amount;
                db.run('UPDATE withdraw_requests SET status = "Aprovado", processed_by = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [req.admin.id, id]);
                db.run('UPDATE users SET balance = ?, total_withdraws = total_withdraws + ? WHERE id = ?',
                    [balanceAfter, withdraw.amount, withdraw.user_id], function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Erro ao debitar' });
                        }
                        db.run('COMMIT');
                        sendRealTimeUpdate(withdraw.user_id, 'withdraw_approved', { amount: withdraw.amount, newBalance: balanceAfter });
                        res.json({ success: true, message: 'Saque aprovado!' });
                    });
            });
        });
    });
});

// Rejeitar saque
app.post('/api/admin/withdraw/:id/reject', checkAdmin, (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    db.run('UPDATE withdraw_requests SET status = "Rejeitado", processed_by = ?, notes = ? WHERE id = ?',
        [req.admin.id, reason || '', id], function(err) {
            if (err) return res.status(500).json({ error: 'Erro ao rejeitar' });
            db.get('SELECT user_id, amount FROM withdraw_requests WHERE id = ?', [id], (err, withdraw) => {
                if (withdraw) sendRealTimeUpdate(withdraw.user_id, 'withdraw_rejected', { amount: withdraw.amount, reason });
            });
            res.json({ message: 'Saque rejeitado' });
        });
});

// Histórico recente
app.get('/api/admin/recent-history', checkAdmin, (req, res) => {
    db.all(`SELECT gh.*, u.name FROM game_history gh
            JOIN users u ON gh.user_id = u.id
            ORDER BY gh.created_at DESC LIMIT 50`, [], (err, history) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar histórico' });
        res.json(history);
    });
});

// Configurações
app.get('/api/admin/config', checkAdmin, (req, res) => {
    db.get('SELECT * FROM admin_config WHERE id = 1', (err, config) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar configurações' });
        res.json(config);
    });
});

// Salvar configurações
app.post('/api/admin/config', checkAdmin, (req, res) => {
    const {
        pix_key, min_deposit, bonus_amount, min_withdraw, max_withdraw,
        withdraw_fee, slot_min_bet, dice_min_bet, crash_min_bet, roulette_min_bet, blackjack_min_bet,
        slot_rtp, dice_rtp, crash_rtp, roulette_rtp, blackjack_rtp,
        slot_volatility, dice_volatility, crash_volatility,
        site_name, contact_email, logo_path, primary_color
    } = req.body;

    db.run(`
        UPDATE admin_config SET
            pix_key = ?, min_deposit = ?, bonus_amount = ?, min_withdraw = ?, max_withdraw = ?,
            withdraw_fee = ?, slot_min_bet = ?, dice_min_bet = ?, crash_min_bet = ?, roulette_min_bet = ?, blackjack_min_bet = ?,
            slot_rtp = ?, dice_rtp = ?, crash_rtp = ?, roulette_rtp = ?, blackjack_rtp = ?,
            slot_volatility = ?, dice_volatility = ?, crash_volatility = ?,
            site_name = ?, contact_email = ?, logo_path = ?, primary_color = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
    `,
        [pix_key, min_deposit, bonus_amount, min_withdraw, max_withdraw,
         withdraw_fee, slot_min_bet, dice_min_bet, crash_min_bet, roulette_min_bet, blackjack_min_bet,
         slot_rtp, dice_rtp, crash_rtp, roulette_rtp, blackjack_rtp,
         slot_volatility, dice_volatility, crash_volatility,
         site_name, contact_email, logo_path, primary_color],
        function (err) {
            if (err) {
                console.error('Erro ao salvar config:', err);
                return res.status(500).json({ error: 'Erro ao salvar' });
            }
            db.get('SELECT * FROM admin_config WHERE id = 1', (err, config) => {
                if (!err && config) sendToAllAdmins('config_updated', config);
            });
            res.json({ success: true, message: '✅ Configurações salvas!' });
        });
});

// Dados do usuário
app.get('/api/user/:id', (req, res) => {
    db.get(`SELECT id, name, email, pix_key, cpf, phone, balance, status,
                   total_deposits, total_withdraws, total_bets, total_wins,
                   affiliate_code, referred_by, affiliate_balance, affiliate_commission
            FROM users WHERE id = ?`, [req.params.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
        res.json(user);
    });
});

app.get('/api/user/:id/history', (req, res) => {
    db.all(`SELECT * FROM game_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
        [req.params.id], (err, rows) => {
            if (err) return res.status(500).json({ error: 'Erro ao buscar histórico' });
            res.json(rows);
        });
});

app.get('/', (req, res) => res.redirect('/login'));

server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📱 Login: http://localhost:${PORT}/login`);
    console.log(`👤 Cadastro: http://localhost:${PORT}/cadastro`);
    console.log(`🎮 Jogos: http://localhost:${PORT}/dashboard`);
    console.log(`⚙️ Admin: http://localhost:${PORT}/admin`);
    console.log(`🔌 WebSocket ativo`);
});