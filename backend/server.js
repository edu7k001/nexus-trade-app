const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Conexão com banco de dados
const db = new sqlite3.Database('./database.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco:', err);
        return;
    }
    console.log('✅ Banco de dados SQLite conectado');
    
    // Cria todas as tabelas
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
            meta_atual INTEGER DEFAULT 1,
            meta_progress REAL DEFAULT 0,
            is_admin INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME
        );

        -- Tabela de configurações
        CREATE TABLE IF NOT EXISTS config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            pix_key TEXT DEFAULT 'suachavepix',
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
            fortune_ox_rtp REAL DEFAULT 96,
            slot_rtp REAL DEFAULT 95,
            dice_rtp REAL DEFAULT 95,
            maintenance_mode INTEGER DEFAULT 0,
            allow_deposits INTEGER DEFAULT 1,
            allow_withdraws INTEGER DEFAULT 1
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
            name TEXT,
            cpf TEXT,
            pix_key TEXT,
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
        if (err) {
            console.error('Erro ao criar tabelas:', err);
        } else {
            console.log('✅ Tabelas criadas/verificadas');
            
            // Insere configurações padrão
            db.run(`INSERT OR IGNORE INTO config (id) VALUES (1)`);
            
            // Cria usuário admin padrão
            const adminPassword = bcrypt.hashSync('admin123', 10);
            db.run(
                `INSERT OR IGNORE INTO users (name, email, password, is_admin, status) 
                 VALUES (?, ?, ?, ?, ?)`,
                ['Administrador', 'admin@nexus.com', adminPassword, 1, 'Ativo']
            );
        }
    });
});

// ==================== ROTAS PÚBLICAS ====================

// Página inicial
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Servir páginas HTML
app.get('/:page', (req, res) => {
    const page = req.params.page;
    const filePath = path.join(__dirname, '../frontend', `${page}.html`);
    res.sendFile(filePath, (err) => {
        if (err) {
            res.status(404).sendFile(path.join(__dirname, '../frontend/404.html'));
        }
    });
});

// ==================== ROTAS DE AUTENTICAÇÃO ====================

// Registro de usuário
app.post('/api/register', (req, res) => {
    const { name, email, password, cpf, phone, pix_key } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }
    
    // Busca configurações para bônus inicial
    db.get('SELECT initial_bonus, rollover_multiplier FROM config WHERE id = 1', (err, config) => {
        const initialBonus = config?.initial_bonus || 20;
        const rolloverMult = config?.rollover_multiplier || 10;
        const rolloverNeeded = initialBonus * rolloverMult;
        
        const hashedPassword = bcrypt.hashSync(password, 10);
        
        db.run(
            `INSERT INTO users (name, email, password, cpf, phone, pix_key, bonus_balance, rollover_remaining, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, email, hashedPassword, cpf, phone, pix_key, initialBonus, rolloverNeeded, 'Pendente'],
            function(err) {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: 'Erro ao cadastrar. Email já existe?' });
                }
                
                res.status(201).json({ 
                    success: true, 
                    message: `Cadastro realizado! Bônus de R$ ${initialBonus} creditado.`,
                    user_id: this.lastID
                });
            }
        );
    });
});

// Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }
        
        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }
        
        // Atualiza último login
        db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
        
        // Determina redirecionamento
        let redirect = '/dashboard.html';
        if (user.is_admin === 1) {
            redirect = '/admin.html';
        }
        
        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                balance: user.balance,
                bonus_balance: user.bonus_balance,
                total_balance: user.balance + user.bonus_balance,
                status: user.status,
                is_admin: user.is_admin,
                meta_atual: user.meta_atual,
                meta_progress: user.meta_progress,
                rollover_remaining: user.rollover_remaining
            },
            redirect
        });
    });
});

// ==================== ROTAS DE USUÁRIO ====================

// Buscar dados do usuário
app.get('/api/user/:id', (req, res) => {
    db.get(
        `SELECT id, name, email, cpf, phone, pix_key, balance, bonus_balance, 
                rollover_remaining, status, meta_atual, meta_progress 
         FROM users WHERE id = ?`,
        [req.params.id],
        (err, user) => {
            if (err || !user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }
            
            res.json({
                ...user,
                total_balance: user.balance + user.bonus_balance
            });
        }
    );
});

// ==================== ROTAS DE DEPÓSITO ====================

// Gerar QR Code PIX
app.get('/api/pix-qrcode', async (req, res) => {
    db.get('SELECT pix_key FROM config WHERE id = 1', async (err, config) => {
        if (err || !config || !config.pix_key) {
            return res.status(500).json({ error: 'Chave PIX não configurada' });
        }
        
        try {
            const qrcode = await QRCode.toDataURL(config.pix_key);
            res.json({ qrcode, pix_key: config.pix_key });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao gerar QR Code' });
        }
    });
});

// Solicitar depósito
app.post('/api/request-deposit', (req, res) => {
    const { user_id, amount } = req.body;
    
    if (!user_id || !amount || amount < 20) {
        return res.status(400).json({ error: 'Valor mínimo de depósito: R$ 20' });
    }
    
    db.get('SELECT allow_deposits FROM config WHERE id = 1', (err, config) => {
        if (config?.allow_deposits === 0) {
            return res.status(400).json({ error: 'Depósitos temporariamente desativados' });
        }
        
        db.run(
            'INSERT INTO deposits (user_id, amount) VALUES (?, ?)',
            [user_id, amount],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Erro ao solicitar depósito' });
                }
                
                res.json({ 
                    success: true, 
                    message: 'Solicitação de depósito registrada. Aguarde confirmação.' 
                });
            }
        );
    });
});

// ==================== ROTAS DE SAQUE ====================

// Solicitar saque
app.post('/api/request-withdraw', (req, res) => {
    const { user_id, amount, name, cpf, pix_key } = req.body;
    
    db.get('SELECT allow_withdraws, min_withdraw, max_withdraw, withdraw_fee FROM config WHERE id = 1', (err, config) => {
        if (config?.allow_withdraws === 0) {
            return res.status(400).json({ error: 'Saques temporariamente desativados' });
        }
        
        if (amount < config.min_withdraw) {
            return res.status(400).json({ error: `Valor mínimo para saque: R$ ${config.min_withdraw}` });
        }
        
        if (amount > config.max_withdraw) {
            return res.status(400).json({ error: `Valor máximo para saque: R$ ${config.max_withdraw}` });
        }
        
        db.get('SELECT balance FROM users WHERE id = ?', [user_id], (err, user) => {
            if (user.balance < amount) {
                return res.status(400).json({ error: 'Saldo insuficiente' });
            }
            
            const fee = amount * (config.withdraw_fee / 100);
            const finalAmount = amount - fee;
            
            db.run(
                `INSERT INTO withdraws (user_id, amount, name, cpf, pix_key) 
                 VALUES (?, ?, ?, ?, ?)`,
                [user_id, finalAmount, name, cpf, pix_key],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Erro ao solicitar saque' });
                    }
                    
                    // Debita o valor da conta
                    db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, user_id]);
                    
                    res.json({ 
                        success: true, 
                        message: `Saque solicitado! Valor líquido: R$ ${finalAmount.toFixed(2)}` 
                    });
                }
            );
        });
    });
});

// ==================== ROTAS DE JOGOS ====================

// Fortune Ox
app.post('/api/game/fortune-ox', (req, res) => {
    const { user_id, bet_amount } = req.body;
    
    db.get('SELECT * FROM users WHERE id = ?', [user_id], (err, user) => {
        if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
        
        const totalBalance = user.balance + user.bonus_balance;
        if (totalBalance < bet_amount) {
            return res.status(400).json({ error: 'Saldo insuficiente' });
        }
        
        if (user.status === 'Aguardando Depósito') {
            return res.status(400).json({ error: 'Complete a meta inicial para depositar' });
        }
        
        // Define qual saldo usar (bônus primeiro)
        let useBonus = 0;
        let useReal = 0;
        
        if (user.bonus_balance >= bet_amount) {
            useBonus = bet_amount;
        } else {
            useBonus = user.bonus_balance;
            useReal = bet_amount - user.bonus_balance;
        }
        
        // Simula o jogo Fortune Ox
        const symbols = ['🐂', '🪙', '🧧', '💰', '🧨', '🍊', '🎆'];
        const reels = [
            [symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)]],
            [symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)]],
            [symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)], symbols[Math.floor(Math.random()*7)]]
        ];
        
        // Calcula ganhos (simplificado)
        let winAmount = 0;
        
        // Linhas horizontais
        for (let row = 0; row < 3; row++) {
            if (reels[0][row] === reels[1][row] && reels[1][row] === reels[2][row]) {
                const symbol = reels[0][row];
                if (symbol === '🐂') winAmount += bet_amount * 20;
                else if (symbol === '🪙') winAmount += bet_amount * 10;
                else if (symbol === '🧧') winAmount += bet_amount * 5;
                else if (symbol === '💰') winAmount += bet_amount * 3;
                else winAmount += bet_amount * 2;
            }
        }
        
        // Aplica RTP
        db.get('SELECT fortune_ox_rtp FROM config WHERE id = 1', (err, config) => {
            const rtp = (config?.fortune_ox_rtp || 96) / 100;
            winAmount = Math.floor(winAmount * rtp);
            
            // Atualiza saldos
            let newBonusBalance = user.bonus_balance - useBonus;
            let newRealBalance = user.balance - useReal;
            
            if (winAmount > 0) {
                newRealBalance += winAmount;
                
                // Atualiza rollover
                if (user.rollover_remaining > 0) {
                    const newRollover = Math.max(0, user.rollover_remaining - bet_amount);
                    db.run('UPDATE users SET rollover_remaining = ? WHERE id = ?', [newRollover, user_id]);
                }
            }
            
            // Atualiza progresso da meta
            const newMetaProgress = user.meta_progress + winAmount;
            let newStatus = user.status;
            
            db.get('SELECT initial_goal, post_goal FROM config WHERE id = 1', (err, goals) => {
                if (user.meta_atual === 1 && newMetaProgress >= goals.initial_goal) {
                    newStatus = 'Aguardando Depósito';
                } else if (user.meta_atual === 2 && newMetaProgress >= goals.post_goal) {
                    newStatus = 'Pode Sacar';
                }
                
                // Atualiza usuário no banco
                db.run(
                    `UPDATE users SET 
                        balance = ?, 
                        bonus_balance = ?, 
                        total_bets = total_bets + ?,
                        total_wins = total_wins + ?,
                        status = ?,
                        meta_progress = ?
                     WHERE id = ?`,
                    [newRealBalance, newBonusBalance, bet_amount, winAmount, newStatus, newMetaProgress, user_id],
                    (err) => {
                        if (err) console.error(err);
                        
                        // Registra no histórico
                        db.run(
                            `INSERT INTO game_history (user_id, game, bet_amount, win_amount, result) 
                             VALUES (?, ?, ?, ?, ?)`,
                            [user_id, 'fortune-ox', bet_amount, winAmount, winAmount > 0 ? 'win' : 'lose']
                        );
                        
                        res.json({
                            success: true,
                            reels,
                            win_amount: winAmount,
                            new_balance: newRealBalance + newBonusBalance,
                            message: winAmount > 0 
                                ? `🎉 Parabéns! Você ganhou R$ ${winAmount.toFixed(2)}!` 
                                : `😢 Que pena! Você perdeu R$ ${bet_amount.toFixed(2)}.`,
                            status: newStatus,
                            meta_progress: newMetaProgress
                        });
                    }
                );
            });
        });
    });
});

// ==================== ROTAS ADMIN ====================

// Middleware de autenticação admin
const requireAdmin = (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
        return res.status(401).json({ error: 'Autenticação necessária' });
    }
    
    const base64 = auth.split(' ')[1];
    const [email, password] = Buffer.from(base64, 'base64').toString().split(':');
    
    db.get('SELECT * FROM users WHERE email = ? AND is_admin = 1', [email], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        req.user = user;
        next();
    });
};

// Estatísticas do dashboard
app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const stats = {};
    
    db.get('SELECT COUNT(*) as total_users FROM users WHERE is_admin = 0', (err, users) => {
        stats.total_users = users?.total_users || 0;
        
        db.get('SELECT COUNT(*) as online_users FROM users WHERE last_login > datetime("now", "-5 minutes")', (err, online) => {
            stats.online_users = online?.online_users || 0;
            
            db.get('SELECT SUM(balance + bonus_balance) as total_balance FROM users', (err, balance) => {
                stats.total_balance = balance?.total_balance || 0;
                
                db.get('SELECT COUNT(*) as pending_deposits FROM deposits WHERE status = "pending"', (err, deposits) => {
                    stats.pending_deposits = deposits?.pending_deposits || 0;
                    
                    db.get('SELECT COUNT(*) as pending_withdraws FROM withdraws WHERE status = "pending"', (err, withdraws) => {
                        stats.pending_withdraws = withdraws?.pending_withdraws || 0;
                        
                        db.get('SELECT SUM(bet_amount) as total_bets, SUM(win_amount) as total_wins FROM game_history', (err, games) => {
                            stats.total_bets = games?.total_bets || 0;
                            stats.total_wins = games?.total_wins || 0;
                            
                            res.json(stats);
                        });
                    });
                });
            });
        });
    });
});

// Listar usuários
app.get('/api/admin/users', requireAdmin, (req, res) => {
    const { search, status } = req.query;
    let sql = 'SELECT id, name, email, cpf, phone, pix_key, balance, bonus_balance, rollover_remaining, status, meta_atual, meta_progress, created_at FROM users WHERE is_admin = 0';
    const params = [];
    
    if (search) {
        sql += ' AND (name LIKE ? OR email LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }
    
    if (status && status !== 'todos') {
        sql += ' AND status = ?';
        params.push(status);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    db.all(sql, params, (err, users) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar usuários' });
        res.json(users);
    });
});

// Atualizar usuário
app.post('/api/admin/user/:id/update', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { name, email, cpf, phone, pix_key, balance, bonus_balance, status } = req.body;
    
    db.run(
        `UPDATE users SET 
            name = ?, email = ?, cpf = ?, phone = ?, pix_key = ?, 
            balance = ?, bonus_balance = ?, status = ? 
         WHERE id = ?`,
        [name, email, cpf, phone, pix_key, balance, bonus_balance, status, id],
        function(err) {
            if (err) return res.status(500).json({ error: 'Erro ao atualizar' });
            res.json({ success: true, message: 'Usuário atualizado' });
        }
    );
});

// Listar depósitos pendentes
app.get('/api/admin/deposits', requireAdmin, (req, res) => {
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

// Confirmar depósito
app.post('/api/admin/confirm-deposit/:id', requireAdmin, (req, res) => {
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
                
                db.run(
                    'UPDATE deposits SET status = "confirmed", confirmed_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [id]
                );
                
                // Se estava aguardando depósito, libera
                db.run(
                    `UPDATE users SET status = 'Ativo', meta_atual = 2 
                     WHERE id = ? AND status = 'Aguardando Depósito'`,
                    [deposit.user_id]
                );
                
                res.json({ 
                    success: true, 
                    message: `Depósito confirmado! R$ ${totalAmount} + bônus R$ ${bonusAmount}` 
                });
            }
        );
    });
});

// Listar saques pendentes
app.get('/api/admin/withdraws', requireAdmin, (req, res) => {
    db.all(
        `SELECT w.*, u.name, u.email, u.balance 
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
app.post('/api/admin/withdraw/:id/approve', requireAdmin, (req, res) => {
    const { id } = req.params;
    
    db.run(
        'UPDATE withdraws SET status = "approved", processed_at = CURRENT_TIMESTAMP WHERE id = ?',
        [id],
        (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao aprovar' });
            res.json({ success: true, message: 'Saque aprovado' });
        }
    );
});

// Rejeitar saque
app.post('/api/admin/withdraw/:id/reject', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    
    db.get('SELECT user_id, amount FROM withdraws WHERE id = ?', [id], (err, withdraw) => {
        if (!withdraw) return res.status(404).json({ error: 'Saque não encontrado' });
        
        // Devolve o saldo
        db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [withdraw.amount, withdraw.user_id], (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao devolver saldo' });
            
            db.run(
                'UPDATE withdraws SET status = "rejected" WHERE id = ?',
                [id]
            );
            
            res.json({ success: true, message: 'Saque rejeitado e saldo devolvido' });
        });
    });
});

// Histórico de jogos
app.get('/api/admin/game-history', requireAdmin, (req, res) => {
    const { limit = 100 } = req.query;
    
    db.all(
        `SELECT h.*, u.name, u.email 
         FROM game_history h 
         JOIN users u ON h.user_id = u.id 
         ORDER BY h.created_at DESC 
         LIMIT ?`,
        [limit],
        (err, history) => {
            if (err) return res.status(500).json({ error: 'Erro ao buscar histórico' });
            res.json(history);
        }
    );
});

// Buscar configurações
app.get('/api/admin/config', requireAdmin, (req, res) => {
    db.get('SELECT * FROM config WHERE id = 1', [], (err, config) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar configurações' });
        res.json(config);
    });
});

// Salvar configurações
app.post('/api/admin/config', requireAdmin, (req, res) => {
    const config = req.body;
    
    db.run(
        `UPDATE config SET 
            pix_key = ?, min_deposit = ?, bonus_deposit = ?, 
            min_withdraw = ?, max_withdraw = ?, withdraw_fee = ?,
            initial_bonus = ?, initial_goal = ?, required_deposit = ?, 
            post_goal = ?, rollover_multiplier = ?, enable_rollover = ?,
            fortune_ox_rtp = ?, slot_rtp = ?, dice_rtp = ?,
            maintenance_mode = ?, allow_deposits = ?, allow_withdraws = ?
         WHERE id = 1`,
        [
            config.pix_key, config.min_deposit, config.bonus_deposit,
            config.min_withdraw, config.max_withdraw, config.withdraw_fee,
            config.initial_bonus, config.initial_goal, config.required_deposit,
            config.post_goal, config.rollover_multiplier, config.enable_rollover,
            config.fortune_ox_rtp, config.slot_rtp, config.dice_rtp,
            config.maintenance_mode, config.allow_deposits, config.allow_withdraws
        ],
        function(err) {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Erro ao salvar configurações' });
            }
            res.json({ success: true, message: 'Configurações salvas' });
        }
    );
});

// ==================== ROTA DE TESTE ====================

app.get('/api/teste', (req, res) => {
    res.json({ 
        success: true, 
        message: '✅ API funcionando corretamente!',
        timestamp: new Date().toISOString(),
        server: 'Nexus Trade v1.0'
    });
});

// ==================== INICIAR SERVIDOR ====================

app.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════════╗
    ║     🚀 NEXUS TRADE - SERVIDOR ATIVO      ║
    ╠══════════════════════════════════════════╣
    ║  Porta: ${PORT}                             ║
    ║  Frontend: /frontend                     ║
    ║  Admin: admin@nexus.com / admin123       ║
    ╚══════════════════════════════════════════╝
    `);
});
