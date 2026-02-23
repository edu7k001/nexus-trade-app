const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Conecta ao banco de dados SQLite
const db = new sqlite3.Database('./database.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) return console.error(err.message);
    console.log('✅ Conectado ao DB SQLite.');
    
    // Cria as tabelas com sistema de metas e rollover
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        cpf TEXT,
        phone TEXT,
        pix_key TEXT UNIQUE,
        balance REAL DEFAULT 0,
        bonus_balance REAL DEFAULT 0,
        rollover_remaining REAL DEFAULT 0,
        total_bets REAL DEFAULT 0,
        status TEXT DEFAULT 'Pendente',
        meta_atual INTEGER DEFAULT 1,
        meta_progress REAL DEFAULT 0,
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
        
        -- Sistema de metas e rollover
        initial_bonus REAL DEFAULT 20,
        initial_goal REAL DEFAULT 100,
        required_deposit REAL DEFAULT 50,
        post_deposit_goal REAL DEFAULT 500,
        rollover_multiplier REAL DEFAULT 10,
        enable_rollover INTEGER DEFAULT 1,
        
        -- Configurações de jogo
        slot_min_bet REAL DEFAULT 5,
        dice_min_bet REAL DEFAULT 5,
        crash_min_bet REAL DEFAULT 5,
        roulette_min_bet REAL DEFAULT 5,
        blackjack_min_bet REAL DEFAULT 5,
        fortune_ox_min_bet REAL DEFAULT 5,
        
        slot_rtp REAL DEFAULT 95,
        dice_rtp REAL DEFAULT 95,
        crash_rtp REAL DEFAULT 95,
        roulette_rtp REAL DEFAULT 95,
        blackjack_rtp REAL DEFAULT 95,
        fortune_ox_rtp REAL DEFAULT 96.75,
        
        -- Controle manual
        maintenance_mode INTEGER DEFAULT 0,
        allow_withdrawals INTEGER DEFAULT 1,
        allow_deposits INTEGER DEFAULT 1
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

    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT,
        amount REAL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Insere configuração padrão
    db.run(`INSERT OR IGNORE INTO admin_config (id, pix_key, min_deposit, bonus_amount, min_withdraw, max_withdraw, withdraw_fee, 
            initial_bonus, initial_goal, required_deposit, post_deposit_goal, rollover_multiplier, enable_rollover,
            slot_min_bet, dice_min_bet, crash_min_bet, roulette_min_bet, blackjack_min_bet, fortune_ox_min_bet,
            slot_rtp, dice_rtp, crash_rtp, roulette_rtp, blackjack_rtp, fortune_ox_rtp,
            maintenance_mode, allow_withdrawals, allow_deposits) 
            VALUES (1, 'SUA_CHAVE_PIX_AQUI', 20, 30, 150, 5000, 0, 
            20, 100, 50, 500, 10, 1,
            5, 5, 5, 5, 5, 5,
            95, 95, 95, 95, 95, 96.75,
            0, 1, 1)`);
    
    // Cria admin padrão
    db.run(`INSERT OR IGNORE INTO users (name, email, password, status) VALUES ('Admin', 'admin@nexus.com', 'admin123', 'Admin')`);
    
    console.log('✅ Tabelas criadas/verificadas com sucesso');
});

// ==================== ROTAS PÚBLICAS ====================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/:page', (req, res) => {
    const page = req.params.page;
    const filePath = path.join(__dirname, '../frontend', `${page}.html`);
    res.sendFile(filePath, (err) => {
        if (err) {
            res.status(404).send('Página não encontrada');
        }
    });
});

// Rota de cadastro com BÔNUS INICIAL e ROLLOVER
app.post('/api/register', (req, res) => {
    const { name, email, password, cpf, phone, pixKey, ref } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Nome, e-mail e senha obrigatórios.' });
    }

    db.get('SELECT initial_bonus, initial_goal, rollover_multiplier FROM admin_config WHERE id = 1', (err, config) => {
        const initialBonus = config ? config.initial_bonus : 20;
        const initialGoal = config ? config.initial_goal : 100;
        const rolloverMultiplier = config ? config.rollover_multiplier : 10;
        
        const rolloverNeeded = initialBonus * rolloverMultiplier;
        
        const sql = 'INSERT INTO users (name, email, password, cpf, phone, pix_key, balance, bonus_balance, rollover_remaining, status, meta_atual, meta_progress) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        db.run(sql, [name, email, password, cpf, phone, pixKey, 0, initialBonus, rolloverNeeded, 'Pendente', 1, 0], function(err) {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Erro no cadastro. E-mail ou chave PIX já existe.' });
            }
            res.status(201).json({ 
                id: this.lastID, 
                name, 
                email, 
                message: `Cadastro realizado! Bônus de R$ ${initialBonus} creditado. Complete R$ ${initialGoal} em ganhos para liberar.` 
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
        
        let redirect = '/dashboard';
        if (user.status === 'Admin') {
            redirect = '/admin';
        }
        
        res.json({ 
            user: { 
                id: user.id, 
                name: user.name, 
                email: user.email, 
                balance: user.balance + user.bonus_balance,
                bonus_balance: user.bonus_balance,
                real_balance: user.balance,
                rollover_remaining: user.rollover_remaining,
                total_bets: user.total_bets,
                status: user.status,
                pix_key: user.pix_key,
                meta_atual: user.meta_atual,
                meta_progress: user.meta_progress
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
    db.get('SELECT id, name, email, cpf, phone, pix_key, balance, bonus_balance, rollover_remaining, total_bets, status, meta_atual, meta_progress FROM users WHERE id = ?', [req.params.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado.' });
        res.json({
            ...user,
            total_balance: user.balance + user.bonus_balance
        });
    });
});

// Rota para gerar QR Code
app.get('/api/pix-qrcode', async (req, res) => {
    db.get('SELECT pix_key FROM admin_config WHERE id = 1', async (err, row) => {
        if (err || !row || row.pix_key === '1c5c21fc-fcbc-4b28-b285-74156c727917') {
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
    
    db.get('SELECT allow_deposits FROM admin_config WHERE id = 1', (err, config) => {
        if (config && config.allow_deposits === 0) {
            return res.status(400).json({ error: 'Depósitos temporariamente desativados.' });
        }
        
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
});

// Rota para solicitar saque
app.post('/api/request-withdraw', (req, res) => {
    const { userId, amount, name, cpf, pixKey } = req.body;
    
    db.get('SELECT allow_withdrawals, min_withdraw, max_withdraw, withdraw_fee FROM admin_config WHERE id = 1', (err, config) => {
        if (config && config.allow_withdrawals === 0) {
            return res.status(400).json({ error: 'Saques temporariamente desativados.' });
        }
        
        if (amount < config.min_withdraw) {
            return res.status(400).json({ error: `Valor mínimo para saque: R$ ${config.min_withdraw}` });
        }
        
        if (amount > config.max_withdraw) {
            return res.status(400).json({ error: `Valor máximo para saque: R$ ${config.max_withdraw}` });
        }
        
        db.get('SELECT balance, status FROM users WHERE id = ?', [userId], (err, user) => {
            if (user.status !== 'Pode Sacar' && user.status !== 'Ativo') {
                return res.status(400).json({ error: 'Você ainda não pode sacar. Complete as metas primeiro.' });
            }
            
            if (user.balance < amount) {
                return res.status(400).json({ error: 'Saldo insuficiente.' });
            }
            
            const fee = amount * (config.withdraw_fee / 100);
            const finalAmount = amount - fee;
            
            db.run('INSERT INTO withdraw_requests (user_id, amount, name, cpf, pix_key, status) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, finalAmount, name, cpf, pixKey, 'Pendente'], function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Erro ao solicitar saque.' });
                }
                
                db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, userId]);
                
                res.json({ message: `Saque solicitado! Valor líquido: R$ ${finalAmount.toFixed(2)}` });
            });
        });
    });
});

// ==================== ROTAS DE JOGOS ====================

// Função auxiliar para processar apostas com rollover
function processBet(userId, game, betAmount, winAmount, callback) {
    db.get('SELECT balance, bonus_balance, rollover_remaining, total_bets, status, meta_atual, meta_progress FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) return callback(err);
        
        // Decide qual saldo usar (bônus primeiro)
        let useBonus = 0;
        let useReal = 0;
        
        if (user.bonus_balance >= betAmount) {
            useBonus = betAmount;
        } else {
            useBonus = user.bonus_balance;
            useReal = betAmount - user.bonus_balance;
        }
        
        // Atualiza saldos
        let newBonusBalance = user.bonus_balance - useBonus;
        let newRealBalance = user.balance - useReal;
        
        // Processa ganhos
        if (winAmount > 0) {
            // Ganhos vão para saldo real
            newRealBalance += winAmount;
            
            // Atualiza rollover (apenas para ganhos com bônus)
            if (user.rollover_remaining > 0) {
                const newRollover = Math.max(0, user.rollover_remaining - betAmount);
                db.run('UPDATE users SET rollover_remaining = ? WHERE id = ?', [newRollover, userId]);
            }
        }
        
        // Atualiza total de apostas
        const newTotalBets = user.total_bets + betAmount;
        
        // Verifica metas
        let newStatus = user.status;
        let newMeta = user.meta_atual;
        let newMetaProgress = user.meta_progress + winAmount;
        
        db.get('SELECT initial_goal, required_deposit, post_deposit_goal FROM admin_config WHERE id = 1', (err, config) => {
            if (user.meta_atual === 1 && newMetaProgress >= config.initial_goal) {
                newStatus = 'Aguardando Depósito';
            } else if (user.meta_atual === 2 && newMetaProgress >= config.post_deposit_goal) {
                newStatus = 'Pode Sacar';
            }
            
            // Atualiza usuário
            db.run('UPDATE users SET balance = ?, bonus_balance = ?, total_bets = ?, status = ?, meta_progress = ? WHERE id = ?',
                [newRealBalance, newBonusBalance, newTotalBets, newStatus, newMetaProgress, userId], (err) => {
                if (err) return callback(err);
                
                // Registra histórico
                db.run('INSERT INTO game_history (user_id, game, bet_amount, result, win_amount) VALUES (?, ?, ?, ?, ?)',
                    [userId, game, betAmount, winAmount > 0 ? 'win' : 'lose', winAmount]);
                
                // Registra transação
                db.run('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
                    [userId, winAmount > 0 ? 'win' : 'bet', winAmount > 0 ? winAmount : betAmount, 
                     `${game}: ${winAmount > 0 ? 'Ganhou' : 'Perdeu'} R$ ${winAmount > 0 ? winAmount : betAmount}`]);
                
                callback(null, {
                    newBalance: newRealBalance + newBonusBalance,
                    newBonusBalance,
                    newRealBalance,
                    rollover_remaining: user.rollover_remaining,
                    status: newStatus,
                    meta_progress: newMetaProgress
                });
            });
        });
    });
}

// FORTUNE OX
app.post('/api/game/fortune-ox', (req, res) => {
    const { userId, betAmount } = req.body;
    
    db.get('SELECT maintenance_mode FROM admin_config WHERE id = 1', (err, config) => {
        if (config && config.maintenance_mode === 1) {
            return res.status(400).json({ error: 'Jogos em manutenção. Tente mais tarde.' });
        }
        
        db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
            if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado.' });
            
            const totalBalance = user.balance + user.bonus_balance;
            if (totalBalance < betAmount) return res.status(400).json({ error: 'Saldo insuficiente.' });
            
            if (user.status === 'Aguardando Depósito') {
                return res.status(400).json({ error: 'Você precisa depositar para continuar jogando.' });
            }
            
            // Simula Fortune Ox (3x4 rolos)
            const symbols = ['🐂', '🪙', '🧧', '💰', '🧨', '🍊', '🎆'];
            const reels = [
                [symbols[Math.floor(Math.random() * symbols.length)], symbols[Math.floor(Math.random() * symbols.length)], symbols[Math.floor(Math.random() * symbols.length)], symbols[Math.floor(Math.random() * symbols.length)]],
                [symbols[Math.floor(Math.random() * symbols.length)], symbols[Math.floor(Math.random() * symbols.length)], symbols[Math.floor(Math.random() * symbols.length)], symbols[Math.floor(Math.random() * symbols.length)]],
                [symbols[Math.floor(Math.random() * symbols.length)], symbols[Math.floor(Math.random() * symbols.length)], symbols[Math.floor(Math.random() * symbols.length)], symbols[Math.floor(Math.random() * symbols.length)]]
            ];
            
            // Calcula ganhos (simplificado mas com RTP configurável)
            let winAmount = 0;
            let multiplier = 1;
            
            // Linhas de pagamento (8 linhas)
            const paylines = [
                [[0,0], [1,0], [2,0]], // Linha 1
                [[0,1], [1,1], [2,1]], // Linha 2
                [[0,2], [1,2], [2,2]], // Linha 3
                [[0,3], [1,3], [2,3]], // Linha 4
                [[0,0], [1,1], [2,2]], // Diagonal
                [[0,3], [1,2], [2,1]], // Diagonal inversa
                [[0,1], [1,2], [2,3]], // Zigzag
                [[0,2], [1,1], [2,0]]  // Zigzag inverso
            ];
            
            paylines.forEach(line => {
                const syms = line.map(pos => reels[pos[0]][pos[1]]);
                if (syms[0] === syms[1] && syms[1] === syms[2]) {
                    if (syms[0] === '🐂') winAmount += betAmount * 20;
                    else if (syms[0] === '🪙') winAmount += betAmount * 10;
                    else if (syms[0] === '🧧') winAmount += betAmount * 5;
                    else if (syms[0] === '💰') winAmount += betAmount * 3;
                    else winAmount += betAmount * 2;
                }
            });
            
            // Ajusta pelo RTP configurado
            db.get('SELECT fortune_ox_rtp FROM admin_config WHERE id = 1', (err, rtpConfig) => {
                const rtp = rtpConfig ? rtpConfig.fortune_ox_rtp / 100 : 0.9675;
                winAmount = winAmount * rtp;
                
                processBet(userId, 'fortune-ox', betAmount, winAmount, (err, result) => {
                    if (err) return res.status(500).json({ error: 'Erro ao processar aposta.' });
                    
                    res.json({
                        reels,
                        win: winAmount,
                        newBalance: result.newBalance,
                        newBonusBalance: result.newBonusBalance,
                        newRealBalance: result.newRealBalance,
                        rollover_remaining: result.rollover_remaining,
                        status: result.status,
                        meta_progress: result.meta_progress,
                        message: winAmount > 0 ? `🎉 GANHOU R$ ${winAmount.toFixed(2)}!` : `😢 Perdeu R$ ${betAmount.toFixed(2)}`
                    });
                });
            });
        });
    });
});

// Slot machine
app.post('/api/game/slot', (req, res) => {
    const { userId, betAmount } = req.body;
    
    db.get('SELECT maintenance_mode FROM admin_config WHERE id = 1', (err, config) => {
        if (config && config.maintenance_mode === 1) {
            return res.status(400).json({ error: 'Jogos em manutenção. Tente mais tarde.' });
        }
        
        db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
            if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado.' });
            
            const totalBalance = user.balance + user.bonus_balance;
            if (totalBalance < betAmount) return res.status(400).json({ error: 'Saldo insuficiente.' });
            
            if (user.status === 'Aguardando Depósito') {
                return res.status(400).json({ error: 'Você precisa depositar para continuar jogando.' });
            }
            
            const symbols = ['🍒', '🍋', '🍊', '7️⃣', '💎', '🎰'];
            const reel1 = symbols[Math.floor(Math.random() * symbols.length)];
            const reel2 = symbols[Math.floor(Math.random() * symbols.length)];
            const reel3 = symbols[Math.floor(Math.random() * symbols.length)];
            
            let winAmount = 0;
            
            if (reel1 === reel2 && reel2 === reel3) {
                winAmount = betAmount * 10;
            } else if (reel1 === reel2 || reel2 === reel3 || reel1 === reel3) {
                winAmount = betAmount * 2;
            }
            
            db.get('SELECT slot_rtp FROM admin_config WHERE id = 1', (err, rtpConfig) => {
                const rtp = rtpConfig ? rtpConfig.slot_rtp / 100 : 0.95;
                winAmount = winAmount * rtp;
                
                processBet(userId, 'slot', betAmount, winAmount, (err, result) => {
                    if (err) return res.status(500).json({ error: 'Erro ao processar aposta.' });
                    
                    res.json({
                        symbols: [reel1, reel2, reel3],
                        win: winAmount,
                        newBalance: result.newBalance,
                        message: winAmount > 0 ? `🎉 GANHOU R$ ${winAmount.toFixed(2)}!` : `😢 Perdeu R$ ${betAmount.toFixed(2)}`
                    });
                });
            });
        });
    });
});

// Dados
app.post('/api/game/dice', (req, res) => {
    const { userId, betAmount, betType } = req.body;
    
    db.get('SELECT maintenance_mode FROM admin_config WHERE id = 1', (err, config) => {
        if (config && config.maintenance_mode === 1) {
            return res.status(400).json({ error: 'Jogos em manutenção. Tente mais tarde.' });
        }
        
        db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
            if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado.' });
            
            const totalBalance = user.balance + user.bonus_balance;
            if (totalBalance < betAmount) return res.status(400).json({ error: 'Saldo insuficiente.' });
            
            if (user.status === 'Aguardando Depósito') {
                return res.status(400).json({ error: 'Você precisa depositar para continuar jogando.' });
            }
            
            const dice1 = Math.floor(Math.random() * 6) + 1;
            const dice2 = Math.floor(Math.random() * 6) + 1;
            const sum = dice1 + dice2;
            
            let winAmount = 0;
            let multiplier = 0;
            
            if (betType.type === 'sum') {
                if (sum === betType.value) {
                    multiplier = betType.value === 7 ? 5 : 15;
                    winAmount = betAmount * multiplier;
                }
            } else if (betType.type === 'double') {
                if (dice1 === dice2) {
                    multiplier = 8;
                    winAmount = betAmount * multiplier;
                }
            } else if (betType.type === 'specific') {
                if (dice1 === betType.value || dice2 === betType.value) {
                    multiplier = 6;
                    winAmount = betAmount * multiplier;
                }
            }
            
            db.get('SELECT dice_rtp FROM admin_config WHERE id = 1', (err, rtpConfig) => {
                const rtp = rtpConfig ? rtpConfig.dice_rtp / 100 : 0.95;
                winAmount = winAmount * rtp;
                
                processBet(userId, 'dice', betAmount, winAmount, (err, result) => {
                    if (err) return res.status(500).json({ error: 'Erro ao processar aposta.' });
                    
                    res.json({
                        dice: [dice1, dice2],
                        sum,
                        win: winAmount,
                        newBalance: result.newBalance,
                        message: winAmount > 0 ? `🎉 GANHOU R$ ${winAmount.toFixed(2)}!` : `😢 Perdeu R$ ${betAmount.toFixed(2)}`
                    });
                });
            });
        });
    });
});

// ==================== ROTAS ADMIN COMPLETAS ====================

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

// Dashboard stats
app.get('/api/admin/stats', checkAdmin, (req, res) => {
    const stats = {};
    
    db.get('SELECT COUNT(*) as total_users, SUM(balance) as total_balance, SUM(bonus_balance) as total_bonus FROM users', (err, users) => {
        stats.total_users = users.total_users || 0;
        stats.total_balance = (users.total_balance || 0) + (users.total_bonus || 0);
        
        db.get('SELECT COUNT(*) as pending_deposits, SUM(amount) as pending_deposits_amount FROM deposit_requests WHERE status = "Pendente"', (err, deposits) => {
            stats.pending_deposits = deposits.pending_deposits || 0;
            stats.pending_deposits_amount = deposits.pending_deposits_amount || 0;
            
            db.get('SELECT COUNT(*) as pending_withdraws, SUM(amount) as pending_withdraws_amount FROM withdraw_requests WHERE status = "Pendente"', (err, withdraws) => {
                stats.pending_withdraws = withdraws.pending_withdraws || 0;
                stats.pending_withdraws_amount = withdraws.pending_withdraws_amount || 0;
                
                db.get('SELECT SUM(total_bets) as total_bets, SUM(win_amount) as total_wins FROM game_history', (err, games) => {
                    stats.total_bets = games.total_bets || 0;
                    stats.total_wins = games.total_wins || 0;
                    
                    db.get('SELECT COUNT(*) as users_online FROM users WHERE last_active > datetime("now", "-5 minutes")', (err, online) => {
                        stats.users_online = online.users_online || 0;
                        
                        res.json(stats);
                    });
                });
            });
        });
    });
});

// Usuários
app.get('/api/admin/users', checkAdmin, (req, res) => {
    const { search, status } = req.query;
    let sql = 'SELECT id, name, email, cpf, phone, pix_key, balance, bonus_balance, rollover_remaining, total_bets, status, meta_atual, meta_progress, created_at FROM users WHERE status != "Admin"';
    let params = [];
    
    if (search) {
        sql += ' AND (name LIKE ? OR email LIKE ? OR pix_key LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    if (status && status !== 'todos') {
        sql += ' AND status = ?';
        params.push(status);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar usuários.' });
        res.json(rows);
    });
});

// Atualizar usuário
app.post('/api/admin/user/:id/update', checkAdmin, (req, res) => {
    const { id } = req.params;
    const { name, email, cpf, phone, pix_key, balance, bonus_balance, status, rollover_remaining, meta_atual, meta_progress } = req.body;
    
    const sql = 'UPDATE users SET name = ?, email = ?, cpf = ?, phone = ?, pix_key = ?, balance = ?, bonus_balance = ?, status = ?, rollover_remaining = ?, meta_atual = ?, meta_progress = ? WHERE id = ?';
    db.run(sql, [name, email, cpf, phone, pix_key, balance, bonus_balance, status, rollover_remaining, meta_atual, meta_progress, id], function(err) {
        if (err) return res.status(500).json({ error: 'Erro ao atualizar usuário.' });
        res.json({ message: 'Usuário atualizado com sucesso!' });
    });
});

// Depósitos pendentes
app.get('/api/admin/deposits', checkAdmin, (req, res) => {
    const sql = `SELECT d.*, u.name, u.email FROM deposit_requests d JOIN users u ON d.user_id = u.id WHERE d.status = 'Pendente' ORDER BY d.created_at DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar depósitos.' });
        res.json(rows);
    });
});

// Confirmar depósito com bônus
app.post('/api/admin/confirm-deposit/:id', checkAdmin, (req, res) => {
    const { id } = req.params;
    const { amount, bonus } = req.body;
    
    db.get('SELECT user_id, amount as requested_amount FROM deposit_requests WHERE id = ?', [id], (err, request) => {
        if (err || !request) return res.status(404).json({ error: 'Depósito não encontrado.' });
        
        const totalAmount = amount || request.requested_amount;
        const bonusAmount = bonus || 0;
        
        db.run('UPDATE users SET balance = balance + ?, bonus_balance = bonus_balance + ? WHERE id = ?', 
            [totalAmount, bonusAmount, request.user_id], (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao creditar saldo.' });
            
            db.run('UPDATE deposit_requests SET status = "Confirmado" WHERE id = ?', [id]);
            
            // Se usuário estava aguardando depósito, libera
            db.run('UPDATE users SET status = "Ativo", meta_atual = 2 WHERE id = ? AND status = "Aguardando Depósito"', [request.user_id]);
            
            res.json({ message: `Depósito confirmado! R$ ${totalAmount} + bônus R$ ${bonusAmount}` });
        });
    });
});

// Saques pendentes
app.get('/api/admin/withdraws', checkAdmin, (req, res) => {
    const sql = `SELECT w.*, u.name, u.email, u.balance FROM withdraw_requests w JOIN users u ON w.user_id = u.id WHERE w.status = 'Pendente' ORDER BY w.created_at DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar saques.' });
        res.json(rows);
    });
});

// Aprovar saque
app.post('/api/admin/withdraw/:id/approve', checkAdmin, (req, res) => {
    const { id } = req.params;
    
    db.run('UPDATE withdraw_requests SET status = "Aprovado" WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: 'Erro ao aprovar saque.' });
        res.json({ message: 'Saque aprovado com sucesso!' });
    });
});

// Rejeitar saque
app.post('/api/admin/withdraw/:id/reject', checkAdmin, (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    
    db.get('SELECT user_id, amount FROM withdraw_requests WHERE id = ?', [id], (err, request) => {
        if (err || !request) return res.status(404).json({ error: 'Saque não encontrado.' });
        
        // Devolve o saldo
        db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [request.amount, request.user_id], (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao devolver saldo.' });
            
            db.run('UPDATE withdraw_requests SET status = "Rejeitado" WHERE id = ?', [id]);
            res.json({ message: 'Saque rejeitado e saldo devolvido.' });
        });
    });
});

// Histórico de jogos
app.get('/api/admin/game-history', checkAdmin, (req, res) => {
    const { limit = 100 } = req.query;
    const sql = `SELECT h.*, u.name, u.email FROM game_history h JOIN users u ON h.user_id = u.id ORDER BY h.created_at DESC LIMIT ?`;
    db.all(sql, [limit], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar histórico.' });
        res.json(rows);
    });
});

// Configurações
app.get('/api/admin/config', checkAdmin, (req, res) => {
    db.get('SELECT * FROM admin_config WHERE id = 1', [], (err, config) => {
        if (err || !config) return res.status(500).json({ error: 'Erro ao buscar configurações.' });
        res.json(config);
    });
});
// Servir arquivos da pasta admin
app.use('/admin', express.static(path.join(__dirname, '../frontend/admin')));
// Salvar configurações
app.post('/api/admin/config', checkAdmin, (req, res) => {
    const config = req.body;
    
    const sql = `UPDATE admin_config SET 
        pix_key = ?, min_deposit = ?, bonus_amount = ?, min_withdraw = ?, max_withdraw = ?, withdraw_fee = ?,
        initial_bonus = ?, initial_goal = ?, required_deposit = ?, post_deposit_goal = ?, rollover_multiplier = ?, enable_rollover = ?,
        slot_min_bet = ?, dice_min_bet = ?, crash_min_bet = ?, roulette_min_bet = ?, blackjack_min_bet = ?, fortune_ox_min_bet = ?,
        slot_rtp = ?, dice_rtp = ?, crash_rtp = ?, roulette_rtp = ?, blackjack_rtp = ?, fortune_ox_rtp = ?,
        maintenance_mode = ?, allow_withdrawals = ?, allow_deposits = ?
        WHERE id = 1`;
    
    db.run(sql, [
        config.pix_key, config.min_deposit, config.bonus_amount, config.min_withdraw, config.max_withdraw, config.withdraw_fee,
        config.initial_bonus, config.initial_goal, config.required_deposit, config.post_deposit_goal, config.rollover_multiplier, config.enable_rollover,
        config.slot_min_bet, config.dice_min_bet, config.crash_min_bet, config.roulette_min_bet, config.blackjack_min_bet, config.fortune_ox_min_bet,
        config.slot_rtp, config.dice_rtp, config.crash_rtp, config.roulette_rtp, config.blackjack_rtp, config.fortune_ox_rtp,
        config.maintenance_mode, config.allow_withdrawals, config.allow_deposits
    ], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Erro ao salvar configurações.' });
        }
        res.json({ message: 'Configurações salvas com sucesso!' });
    });
});
// ROTA TEMPORÁRIA PARA CRIAR ADMIN - REMOVA DEPOIS DE USAR
app.get('/api/criar-admin/:senha', (req, res) => {
    const senha = req.params.senha;
    
    // Senha de segurança para não criar admin qualquer um
    if (senha !== 'criaradmin123') {
        return res.status(403).json({ error: 'Senha incorreta' });
    }
    
    const email = 'admin@nexus.com';
    const password = 'admin123';
    const name = 'Administrador';
    
    db.run('INSERT OR REPLACE INTO users (name, email, password, status) VALUES (?, ?, ?, ?)',
        [name, email, password, 'Admin'],
        function(err) {
            if (err) {
                res.status(500).json({ error: 'Erro ao criar admin: ' + err.message });
            } else {
                res.json({ 
                    success: true, 
                    message: '✅ Admin criado/atualizado com sucesso!',
                    credentials: {
                        email: 'admin@nexus.com',
                        password: 'admin123'
                    }
                });
            }
        }
    );
});
// Inicia o servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📁 Servindo arquivos de: ${path.join(__dirname, '../frontend')}`);
    console.log(`🔗 Acesse: http://localhost:${PORT}`);
});



