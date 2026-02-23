const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ==================== BANCO DE DADOS ====================
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Erro no banco:', err);
    else console.log('✅ Banco de dados conectado');
});

// Criar tabelas
db.exec(`
    -- Tabela de usuários
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        cpf TEXT,
        phone TEXT,
        pix_key TEXT,
        balance REAL DEFAULT 0,
        bonus_balance REAL DEFAULT 0,
        rollover_remaining REAL DEFAULT 0,
        total_bets REAL DEFAULT 0,
        total_wins REAL DEFAULT 0,
        status TEXT DEFAULT 'Pendente',
        rtp_individual REAL DEFAULT NULL,
        is_admin INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
    );

    -- Tabela de administradores
    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Tabela de configurações
    CREATE TABLE IF NOT EXISTS config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        pix_key TEXT DEFAULT '11111111111',
        min_deposit REAL DEFAULT 20,
        bonus_deposit REAL DEFAULT 30,
        min_withdraw REAL DEFAULT 50,
        max_withdraw REAL DEFAULT 5000,
        withdraw_fee REAL DEFAULT 0,
        initial_bonus REAL DEFAULT 20,
        initial_goal REAL DEFAULT 100,
        required_deposit REAL DEFAULT 50,
        post_goal REAL DEFAULT 500,
        rollover_multiplier REAL DEFAULT 10,
        enable_rollover INTEGER DEFAULT 1,
        allow_deposits INTEGER DEFAULT 1,
        allow_withdraws INTEGER DEFAULT 1,
        maintenance_mode INTEGER DEFAULT 0
    );

    -- Tabela de configurações de jogos
    CREATE TABLE IF NOT EXISTS game_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_name TEXT UNIQUE NOT NULL,
        rtp REAL DEFAULT 95,
        min_bet REAL DEFAULT 5,
        max_bet REAL DEFAULT 1000,
        active INTEGER DEFAULT 1
    );

    -- Tabela de depósitos
    CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        bonus REAL DEFAULT 0,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        confirmed_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Tabela de saques
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

    -- Tabela de histórico de jogos
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

    -- Tabela de transações
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
`, (err) => {
    if (err) console.error('Erro ao criar tabelas:', err);
    else {
        console.log('✅ Tabelas criadas/verificadas');
        
        // Inserir admin padrão
        const adminEmail = 'edu7k001@gmail.com';
        const adminPassword = bcrypt.hashSync('@Carlos1998', 10);
        
        db.get('SELECT * FROM admins WHERE email = ?', [adminEmail], (err, admin) => {
            if (!admin) {
                db.run('INSERT INTO admins (email, password, name) VALUES (?, ?, ?)',
                    [adminEmail, adminPassword, 'Administrador']);
                console.log('✅ Admin criado');
            }
        });
        
        // Configurações padrão
        db.run('INSERT OR IGNORE INTO config (id) VALUES (1)');
        
        // Configurações dos jogos
        const games = [
            ['fortune-ox', 96.75, 5, 1000],
            ['fortune-tiger', 96.75, 5, 1000],
            ['fortune-mouse', 96.75, 5, 1000],
            ['slots', 95, 5, 1000],
            ['dice', 95, 5, 1000],
            ['crash', 95, 5, 1000],
            ['roulette', 95, 5, 1000],
            ['blackjack', 95, 5, 1000],
            ['tumble', 97, 5, 1000]
        ];
        
        games.forEach(game => {
            db.run('INSERT OR IGNORE INTO game_config (game_name, rtp, min_bet, max_bet) VALUES (?, ?, ?, ?)',
                game);
        });
    }
});

// ==================== MIDDLEWARES ====================

// Verificar token JWT
function verifyToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    
    jwt.verify(token, 'megabet777_secret', (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Token inválido' });
        req.userId = decoded.id;
        next();
    });
}

// Verificar admin
function verifyAdmin(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Basic ')) {
        return res.status(401).json({ error: 'Não autorizado' });
    }
    
    const base64 = auth.split(' ')[1];
    const [email, password] = Buffer.from(base64, 'base64').toString().split(':');
    
    db.get('SELECT * FROM admins WHERE email = ?', [email], (err, admin) => {
        if (!admin || !bcrypt.compareSync(password, admin.password)) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        req.admin = admin;
        next();
    });
}

// ==================== ROTAS DE AUTENTICAÇÃO ====================

// Login admin (edu7k001@gmail.com / @Carlos1998)
app.post('/api/admin-login', (req, res) => {
    const { email, password } = req.body;
    
    db.get('SELECT * FROM admins WHERE email = ?', [email], (err, admin) => {
        if (!admin || !bcrypt.compareSync(password, admin.password)) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        
        const token = jwt.sign({ id: admin.id, email: admin.email }, 'megabet777_secret');
        res.json({
            success: true,
            token,
            admin: { id: admin.id, email: admin.email, name: admin.name }
        });
    });
});

// Registro de usuário
app.post('/api/register', (req, res) => {
    const { name, email, password, cpf, phone, pix_key } = req.body;
    
    db.get('SELECT initial_bonus FROM config WHERE id = 1', (err, config) => {
        const initialBonus = config?.initial_bonus || 20;
        const hashedPassword = bcrypt.hashSync(password, 10);
        
        db.run(
            `INSERT INTO users (name, email, password, cpf, phone, pix_key, bonus_balance) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name, email, hashedPassword, cpf, phone, pix_key, initialBonus],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Email já cadastrado' });
                }
                
                const token = jwt.sign({ id: this.lastID, email }, 'megabet777_secret');
                res.json({
                    success: true,
                    token,
                    user: { id: this.lastID, name, email, balance: initialBonus }
                });
            }
        );
    });
});

// Login de usuário
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        
        db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
        
        const token = jwt.sign({ id: user.id, email: user.email }, 'megabet777_secret');
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                balance: user.balance,
                bonus_balance: user.bonus_balance,
                total: user.balance + user.bonus_balance,
                status: user.status
            }
        });
    });
});

// ==================== ROTAS ADMIN ====================

// Estatísticas do dashboard
app.get('/api/admin/stats', verifyAdmin, (req, res) => {
    const stats = {};
    
    db.get('SELECT COUNT(*) as total_users FROM users', (err, users) => {
        stats.total_users = users?.total_users || 0;
        
        db.get('SELECT COUNT(*) as online_users FROM users WHERE last_login > datetime("now", "-5 minutes")', (err, online) => {
            stats.online_users = online?.online_users || 0;
            
            db.get('SELECT SUM(balance + bonus_balance) as total_balance FROM users', (err, balance) => {
                stats.total_balance = balance?.total_balance || 0;
                
                db.get('SELECT COUNT(*) as pending_deposits FROM deposits WHERE status = "pending"', (err, deposits) => {
                    stats.pending_deposits = deposits?.pending_deposits || 0;
                    
                    db.get('SELECT SUM(amount) as pending_deposits_amount FROM deposits WHERE status = "pending"', (err, depAmount) => {
                        stats.pending_deposits_amount = depAmount?.pending_deposits_amount || 0;
                        
                        db.get('SELECT COUNT(*) as pending_withdraws FROM withdraws WHERE status = "pending"', (err, withdraws) => {
                            stats.pending_withdraws = withdraws?.pending_withdraws || 0;
                            
                            db.get('SELECT SUM(amount) as pending_withdraws_amount FROM withdraws WHERE status = "pending"', (err, withAmount) => {
                                stats.pending_withdraws_amount = withAmount?.pending_withdraws_amount || 0;
                                
                                db.get('SELECT SUM(bet_amount) as total_bets FROM game_history', (err, bets) => {
                                    stats.total_bets = bets?.total_bets || 0;
                                    
                                    db.get('SELECT SUM(win_amount) as total_wins FROM game_history', (err, wins) => {
                                        stats.total_wins = wins?.total_wins || 0;
                                        res.json(stats);
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

// Listar usuários
app.get('/api/admin/users', verifyAdmin, (req, res) => {
    const { search, status } = req.query;
    let sql = 'SELECT id, name, email, cpf, phone, pix_key, balance, bonus_balance, rollover_remaining, status, rtp_individual, created_at FROM users';
    const params = [];
    
    if (search) {
        sql += ' WHERE name LIKE ? OR email LIKE ?';
        params.push(`%${search}%`, `%${search}%`);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    db.all(sql, params, (err, users) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar usuários' });
        res.json(users);
    });
});

// Atualizar usuário (controle individual)
app.post('/api/admin/user/:id/update', verifyAdmin, (req, res) => {
    const { id } = req.params;
    const { balance, bonus_balance, rollover_remaining, status, rtp_individual } = req.body;
    
    db.run(
        `UPDATE users SET 
            balance = ?,
            bonus_balance = ?,
            rollover_remaining = ?,
            status = ?,
            rtp_individual = ?
         WHERE id = ?`,
        [balance, bonus_balance, rollover_remaining, status, rtp_individual, id],
        function(err) {
            if (err) return res.status(500).json({ error: 'Erro ao atualizar' });
            res.json({ success: true, message: 'Usuário atualizado' });
        }
    );
});

// Listar depósitos pendentes
app.get('/api/admin/deposits', verifyAdmin, (req, res) => {
    db.all(
        `SELECT d.*, u.name, u.email 
         FROM deposits d 
         JOIN users u ON d.user_id = u.id 
         WHERE d.status = 'pending' 
         ORDER BY d.created_at DESC`,
        [],
        (err, deposits) => {
            if (err) return res.status(500).json({ error: 'Erro ao buscar depósitos' });
            res.json(deposits);
        }
    );
});

// Confirmar depósito (com bônus)
app.post('/api/admin/confirm-deposit/:id', verifyAdmin, (req, res) => {
    const { id } = req.params;
    const { amount, bonus } = req.body;
    
    db.get('SELECT user_id FROM deposits WHERE id = ?', [id], (err, deposit) => {
        if (!deposit) return res.status(404).json({ error: 'Depósito não encontrado' });
        
        const totalAmount = amount || 0;
        const bonusAmount = bonus || 0;
        
        db.run(
            'UPDATE users SET balance = balance + ?, bonus_balance = bonus_balance + ? WHERE id = ?',
            [totalAmount, bonusAmount, deposit.user_id],
            (err) => {
                if (err) return res.status(500).json({ error: 'Erro ao creditar' });
                
                db.run('UPDATE deposits SET status = "confirmed", confirmed_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
                
                // Registrar transação
                db.run('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
                    [deposit.user_id, 'deposit', totalAmount, `Depósito de R$ ${totalAmount} + bônus R$ ${bonusAmount}`]);
                
                res.json({ success: true, message: `Depósito confirmado: R$ ${totalAmount} + bônus R$ ${bonusAmount}` });
            }
        );
    });
});

// Rejeitar depósito
app.post('/api/admin/reject-deposit/:id', verifyAdmin, (req, res) => {
    const { id } = req.params;
    db.run('UPDATE deposits SET status = "rejected" WHERE id = ?', [id]);
    res.json({ success: true, message: 'Depósito rejeitado' });
});

// Listar saques pendentes
app.get('/api/admin/withdraws', verifyAdmin, (req, res) => {
    db.all(
        `SELECT w.*, u.name, u.email 
         FROM withdraws w 
         JOIN users u ON w.user_id = u.id 
         WHERE w.status = 'pending' 
         ORDER BY w.created_at DESC`,
        [],
        (err, withdraws) => {
            if (err) return res.status(500).json({ error: 'Erro ao buscar saques' });
            res.json(withdraws);
        }
    );
});

// Aprovar saque
app.post('/api/admin/approve-withdraw/:id', verifyAdmin, (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT user_id, amount FROM withdraws WHERE id = ?', [id], (err, withdraw) => {
        if (!withdraw) return res.status(404).json({ error: 'Saque não encontrado' });
        
        db.run('UPDATE withdraws SET status = "approved", processed_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
        
        db.run('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
            [withdraw.user_id, 'withdraw', withdraw.amount, `Saque de R$ ${withdraw.amount}`]);
        
        res.json({ success: true, message: 'Saque aprovado' });
    });
});

// Rejeitar saque (devolve saldo)
app.post('/api/admin/reject-withdraw/:id', verifyAdmin, (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT user_id, amount FROM withdraws WHERE id = ?', [id], (err, withdraw) => {
        if (!withdraw) return res.status(404).json({ error: 'Saque não encontrado' });
        
        db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [withdraw.amount, withdraw.user_id], (err) => {
            db.run('UPDATE withdraws SET status = "rejected" WHERE id = ?', [id]);
            res.json({ success: true, message: 'Saque rejeitado e saldo devolvido' });
        });
    });
});

// Configurações gerais
app.get('/api/admin/config', verifyAdmin, (req, res) => {
    db.get('SELECT * FROM config WHERE id = 1', (err, config) => {
        res.json(config);
    });
});

// Salvar configurações gerais
app.post('/api/admin/config', verifyAdmin, (req, res) => {
    const config = req.body;
    
    db.run(
        `UPDATE config SET 
            pix_key = ?, min_deposit = ?, bonus_deposit = ?,
            min_withdraw = ?, max_withdraw = ?, withdraw_fee = ?,
            initial_bonus = ?, initial_goal = ?, required_deposit = ?,
            post_goal = ?, rollover_multiplier = ?, enable_rollover = ?,
            allow_deposits = ?, allow_withdraws = ?, maintenance_mode = ?
         WHERE id = 1`,
        [
            config.pix_key, config.min_deposit, config.bonus_deposit,
            config.min_withdraw, config.max_withdraw, config.withdraw_fee,
            config.initial_bonus, config.initial_goal, config.required_deposit,
            config.post_goal, config.rollover_multiplier, config.enable_rollover,
            config.allow_deposits, config.allow_withdraws, config.maintenance_mode
        ],
        function(err) {
            if (err) return res.status(500).json({ error: 'Erro ao salvar' });
            res.json({ success: true, message: 'Configurações salvas' });
        }
    );
});

// Configurações de jogos
app.get('/api/admin/game-config', verifyAdmin, (req, res) => {
    db.all('SELECT * FROM game_config', [], (err, games) => {
        res.json(games);
    });
});

// Salvar configuração de jogo (RTP individual)
app.post('/api/admin/game-config/:game', verifyAdmin, (req, res) => {
    const { game } = req.params;
    const { rtp, min_bet, max_bet, active } = req.body;
    
    db.run(
        'UPDATE game_config SET rtp = ?, min_bet = ?, max_bet = ?, active = ? WHERE game_name = ?',
        [rtp, min_bet, max_bet, active, game],
        function(err) {
            if (err) return res.status(500).json({ error: 'Erro ao salvar' });
            res.json({ success: true, message: 'Configuração do jogo salva' });
        }
    );
});

// Histórico de jogos
app.get('/api/admin/game-history', verifyAdmin, (req, res) => {
    db.all(
        `SELECT h.*, u.name 
         FROM game_history h 
         JOIN users u ON h.user_id = u.id 
         ORDER BY h.created_at DESC 
         LIMIT 100`,
        [],
        (err, history) => {
            res.json(history);
        }
    );
});

// ==================== ROTAS DE JOGOS ====================

// Função para processar aposta com RTP individual
async function processBet(userId, gameName, betAmount, winAmount, gameResult) {
    return new Promise((resolve, reject) => {
        db.get('SELECT balance, bonus_balance, rollover_remaining, rtp_individual FROM users WHERE id = ?', [userId], (err, user) => {
            if (err) return reject(err);
            
            // Aplicar RTP individual se existir
            let finalWinAmount = winAmount;
            if (user.rtp_individual) {
                const rtpMultiplier = user.rtp_individual / 100;
                finalWinAmount = Math.floor(winAmount * rtpMultiplier);
            }
            
            // Decidir qual saldo usar (bônus primeiro)
            let useBonus = 0;
            let useReal = 0;
            
            if (user.bonus_balance >= betAmount) {
                useBonus = betAmount;
            } else {
                useBonus = user.bonus_balance;
                useReal = betAmount - user.bonus_balance;
            }
            
            let newBonusBalance = user.bonus_balance - useBonus;
            let newRealBalance = user.balance - useReal;
            
            if (finalWinAmount > 0) {
                newRealBalance += finalWinAmount;
                
                // Atualizar rollover
                if (user.rollover_remaining > 0) {
                    const newRollover = Math.max(0, user.rollover_remaining - betAmount);
                    db.run('UPDATE users SET rollover_remaining = ? WHERE id = ?', [newRollover, userId]);
                }
            }
            
            db.run(
                'UPDATE users SET balance = ?, bonus_balance = ?, total_bets = total_bets + ? WHERE id = ?',
                [newRealBalance, newBonusBalance, betAmount, userId],
                (err) => {
                    if (err) return reject(err);
                    
                    db.run(
                        'INSERT INTO game_history (user_id, game, bet_amount, win_amount, result) VALUES (?, ?, ?, ?, ?)',
                        [userId, gameName, betAmount, finalWinAmount, gameResult],
                        (err) => {
                            if (err) return reject(err);
                            
                            db.run(
                                'INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
                                [userId, 'bet', betAmount, `${gameName}: Aposta R$ ${betAmount}`]
                            );
                            
                            resolve({
                                newBalance: newRealBalance + newBonusBalance,
                                winAmount: finalWinAmount
                            });
                        }
                    );
                }
            );
        });
    });
}

// Fortune Ox
app.post('/api/game/fortune-ox', async (req, res) => {
    const { userId, betAmount } = req.body;
    
    db.get('SELECT * FROM game_config WHERE game_name = "fortune-ox"', async (err, gameConfig) => {
        if (!gameConfig?.active) {
            return res.status(400).json({ error: 'Jogo temporariamente indisponível' });
        }
        
        if (betAmount < gameConfig.min_bet || betAmount > gameConfig.max_bet) {
            return res.status(400).json({ error: `Aposta deve ser entre R$ ${gameConfig.min_bet} e R$ ${gameConfig.max_bet}` });
        }
        
        // Simulação do jogo
        const symbols = ['🐂', '🪙', '🧧', '💰', '🧨', '🍊', '🎆'];
        const reels = [
            [symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)]],
            [symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)]],
            [symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)]]
        ];
        
        // Calcular ganhos
        let winAmount = 0;
        
        // Linhas horizontais
        for (let row = 0; row < 3; row++) {
            if (reels[0][row] === reels[1][row] && reels[1][row] === reels[2][row]) {
                const symbol = reels[0][row];
                if (symbol === '🐂') winAmount += betAmount * 20;
                else if (symbol === '🪙') winAmount += betAmount * 10;
                else winAmount += betAmount * 5;
            }
        }
        
        // Aplicar RTP configurado
        winAmount = Math.floor(winAmount * (gameConfig.rtp / 100));
        
        try {
            const result = await processBet(userId, 'fortune-ox', betAmount, winAmount, winAmount > 0 ? 'win' : 'lose');
            res.json({
                success: true,
                reels,
                winAmount,
                newBalance: result.newBalance,
                message: winAmount > 0 ? `🎉 GANHOU R$ ${winAmount}!` : `😢 Perdeu R$ ${betAmount}`
            });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao processar aposta' });
        }
    });
});

// Tumble (novo jogo)
app.post('/api/game/tumble', async (req, res) => {
    const { userId, betAmount } = req.body;
    
    db.get('SELECT * FROM game_config WHERE game_name = "tumble"', async (err, gameConfig) => {
        if (!gameConfig?.active) {
            return res.status(400).json({ error: 'Jogo temporariamente indisponível' });
        }
        
        // Simulação do jogo Tumble (queda de pedras)
        const symbols = ['💎', '💰', '⭐', '7️⃣', '🍀', '🔥'];
        const grid = [];
        let winAmount = 0;
        
        // Criar grid 5x5
        for (let i = 0; i < 5; i++) {
            const row = [];
            for (let j = 0; j < 5; j++) {
                row.push(symbols[Math.floor(Math.random() * symbols.length)]);
            }
            grid.push(row);
        }
        
        // Verificar combinações (simplificado)
        for (let i = 0; i < 5; i++) {
            if (grid[i][0] === grid[i][1] && grid[i][1] === grid[i][2] && grid[i][2] === grid[i][3] && grid[i][3] === grid[i][4]) {
                if (grid[i][0] === '💎') winAmount += betAmount * 50;
                else winAmount += betAmount * 20;
            }
        }
        
        winAmount = Math.floor(winAmount * (gameConfig.rtp / 100));
        
        try {
            const result = await processBet(userId, 'tumble', betAmount, winAmount, winAmount > 0 ? 'win' : 'lose');
            res.json({
                success: true,
                grid,
                winAmount,
                newBalance: result.newBalance,
                message: winAmount > 0 ? `🎉 GANHOU R$ ${winAmount}!` : `😢 Perdeu R$ ${betAmount}`
            });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao processar aposta' });
        }
    });
});

// ==================== ROTAS DE TRANSAÇÕES ====================

// Solicitar depósito
app.post('/api/request-deposit', verifyToken, (req, res) => {
    const { amount } = req.body;
    const userId = req.userId;
    
    db.get('SELECT allow_deposits FROM config WHERE id = 1', (err, config) => {
        if (!config?.allow_deposits) {
            return res.status(400).json({ error: 'Depósitos temporariamente desativados' });
        }
        
        if (amount < config.min_deposit) {
            return res.status(400).json({ error: `Mínimo: R$ ${config.min_deposit}` });
        }
        
        db.run('INSERT INTO deposits (user_id, amount) VALUES (?, ?)', [userId, amount], function(err) {
            if (err) return res.status(500).json({ error: 'Erro ao solicitar' });
            res.json({ success: true, message: 'Solicitação enviada', depositId: this.lastID });
        });
    });
});

// Solicitar saque
app.post('/api/request-withdraw', verifyToken, (req, res) => {
    const { amount, pix_key } = req.body;
    const userId = req.userId;
    
    db.get('SELECT balance, status FROM users WHERE id = ?', [userId], (err, user) => {
        if (user.balance < amount) {
            return res.status(400).json({ error: 'Saldo insuficiente' });
        }
        
        if (user.status !== 'Pode Sacar' && user.status !== 'Ativo') {
            return res.status(400).json({ error: 'Complete as metas para sacar' });
        }
        
        db.get('SELECT min_withdraw, max_withdraw, withdraw_fee, allow_withdraws FROM config WHERE id = 1', (err, config) => {
            if (!config?.allow_withdraws) {
                return res.status(400).json({ error: 'Saques temporariamente desativados' });
            }
            
            if (amount < config.min_withdraw) {
                return res.status(400).json({ error: `Mínimo: R$ ${config.min_withdraw}` });
            }
            
            if (amount > config.max_withdraw) {
                return res.status(400).json({ error: `Máximo: R$ ${config.max_withdraw}` });
            }
            
            const fee = amount * (config.withdraw_fee / 100);
            const finalAmount = amount - fee;
            
            // Debita da conta
            db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, userId], (err) => {
                db.run(
                    'INSERT INTO withdraws (user_id, amount, pix_key) VALUES (?, ?, ?)',
                    [userId, finalAmount, pix_key],
                    function(err) {
                        res.json({ success: true, message: `Saque solicitado: R$ ${finalAmount}` });
                    }
                );
            });
        });
    });
});

// Histórico do usuário
app.get('/api/user/history', verifyToken, (req, res) => {
    const userId = req.userId;
    
    db.all(
        'SELECT * FROM game_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
        [userId],
        (err, history) => {
            res.json(history);
        }
    );
});

// Saldo do usuário
app.get('/api/user/balance', verifyToken, (req, res) => {
    const userId = req.userId;
    
    db.get(
        'SELECT balance, bonus_balance, rollover_remaining, status FROM users WHERE id = ?',
        [userId],
        (err, user) => {
            res.json({
                balance: user.balance,
                bonus_balance: user.bonus_balance,
                total: user.balance + user.bonus_balance,
                rollover: user.rollover_remaining,
                status: user.status
            });
        }
    );
});

// ==================== ROTAS DE PÁGINAS ====================

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin-login.html', (req, res) => res.sendFile(path.join(__dirname, 'admin-login.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/deposit.html', (req, res) => res.sendFile(path.join(__dirname, 'deposit.html')));
app.get('/withdraw.html', (req, res) => res.sendFile(path.join(__dirname, 'withdraw.html')));

// Páginas dos jogos
app.get('/fortune-ox.html', (req, res) => res.sendFile(path.join(__dirname, 'games/fortune-ox.html')));
app.get('/fortune-tiger.html', (req, res) => res.sendFile(path.join(__dirname, 'games/fortune-tiger.html')));
app.get('/fortune-mouse.html', (req, res) => res.sendFile(path.join(__dirname, 'games/fortune-mouse.html')));
app.get('/slots.html', (req, res) => res.sendFile(path.join(__dirname, 'games/slots.html')));
app.get('/dice.html', (req, res) => res.sendFile(path.join(__dirname, 'games/dice.html')));
app.get('/crash.html', (req, res) => res.sendFile(path.join(__dirname, 'games/crash.html')));
app.get('/roulette.html', (req, res) => res.sendFile(path.join(__dirname, 'games/roulette.html')));
app.get('/blackjack.html', (req, res) => res.sendFile(path.join(__dirname, 'games/blackjack.html')));
app.get('/tumble.html', (req, res) => res.sendFile(path.join(__dirname, 'games/tumble.html')));

// ==================== INICIAR SERVIDOR ====================

app.listen(PORT, () => {
    console.log('\n=================================');
    console.log('🚀 MEGABET777 - SERVIDOR ATIVO');
    console.log('=================================');
    console.log(`📡 Porta: ${PORT}`);
    console.log(`👑 Admin: edu7k001@gmail.com / @Carlos1998`);
    console.log(`💰 Sistema de pagamentos ativo`);
    console.log(`🎮 9 jogos disponíveis`);
    console.log(`✅ Status: Online`);
    console.log('=================================\n');
});
