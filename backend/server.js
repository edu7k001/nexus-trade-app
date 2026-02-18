const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Configurações
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

    // Configurações do admin
    db.run(`CREATE TABLE IF NOT EXISTS admin_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        pix_key TEXT,
        min_deposit REAL,
        bonus_amount REAL,
        min_withdraw REAL
    )`, (err) => {
        if (!err) {
            db.get('SELECT * FROM admin_config WHERE id = 1', (err, row) => {
                if (!row) {
                    db.run(`INSERT INTO admin_config 
                        (id, pix_key, min_deposit, bonus_amount, min_withdraw) 
                        VALUES (1, '1c5c21fc-fcbc-4b28-b285-74156c727917', 50, 30, 150)`);
                    console.log('✅ Chave PIX configurada: 1c5c21fc-fcbc-4b28-b285-74156c727917');
                }
            });
            
            // Cria usuário admin padrão
            const saltRounds = 10;
            const adminPass = bcrypt.hashSync('admin123', saltRounds);
            db.run(`INSERT OR IGNORE INTO users (name, email, password, status) 
                    VALUES ('Administrador', 'admin@nexus.com', ?, 'Admin')`, [adminPass]);
        }
    });
});

// ===== ROTA DO QR CODE (USANDO A IMAGEM DA PASTA IMAGES) =====
app.get('/api/pix-qrcode', (req, res) => {
    // Verifica se a imagem existe
    const imagePath = path.join(__dirname, '../frontend/images/pix-nexus.png');
    
    if (fs.existsSync(imagePath)) {
        // Se a imagem existe, retorna o caminho
        db.get('SELECT pix_key FROM admin_config WHERE id = 1', (err, row) => {
            if (err || !row) {
                return res.status(500).json({ error: 'Erro ao buscar chave PIX' });
            }
            
            // Retorna a imagem estática
            res.json({ 
                success: true,
                qrcode: '/images/pix-nexus.png', // Caminho da imagem
                pixKey: row.pix_key,
                message: 'QR Code carregado da pasta images!',
                imageExists: true
            });
        });
    } else {
        // Se a imagem não existe, avisa o usuário
        res.status(404).json({ 
            error: 'Imagem do QR Code não encontrada. Por favor, baixe o QR Code do https://geradordepix.com e salve como frontend/images/pix-nexus.png' 
        });
    }
});

// ===== ROTAS DE AUTENTICAÇÃO =====

// Página de cadastro
app.get('/cadastro', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/cadastro.html'));
});

// Página de login
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

// Página do admin
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

// Dashboard do usuário
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dashboard.html'));
});

// API de registro
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

// API de login
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

// ===== ROTAS DO ADMIN =====
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
            db.run('UPDATE users SET balance = balance + ?, status = "Ativo" WHERE id = ?',
                [amount, deposit.user_id]);
            
            db.run('COMMIT');
            res.json({ message: 'Depósito confirmado!' });
        });
    });
});

// Listar saques pendentes
app.get('/api/admin/withdraws', checkAdmin, (req, res) => {
    db.all(`
        SELECT wr.*, u.name, u.email, u.pix_key 
        FROM withdraw_requests wr 
        JOIN users u ON wr.user_id = u.id 
        WHERE wr.status = 'Pendente'
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
            
            db.run('UPDATE users SET balance = balance - ? WHERE id = ?',
                [withdraw.amount, withdraw.user_id]);
            db.run('UPDATE withdraw_requests SET status = "Aprovado" WHERE id = ?', [id]);
            
            db.run('COMMIT');
            res.json({ message: 'Saque aprovado!' });
        });
    });
});

// Buscar dados do usuário
app.get('/api/user/:id', (req, res) => {
    db.get('SELECT id, name, email, pix_key, balance, status FROM users WHERE id = ?',
        [req.params.id],
        (err, user) => {
            if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
            res.json(user);
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

// Rota principal - redireciona para login
app.get('/', (req, res) => {
    res.redirect('/login');
});
// ===== ROTAS DE JOGOS =====

// Rota para jogar slots
app.post('/api/game/slot', (req, res) => {
    const { userId, betAmount } = req.body;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // Buscar saldo do usuário
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
            
            // Gerar resultado
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
            
            // Atualizar saldo
            db.run('UPDATE users SET balance = ?, total_bets = total_bets + ?, total_wins = total_wins + ? WHERE id = ?',
                [newBalance, betAmount, winAmount, userId]);
            
            // Registrar histórico
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
            
            // Gerar resultado
            const d1 = Math.floor(Math.random() * 6) + 1;
            const d2 = Math.floor(Math.random() * 6) + 1;
            const sum = d1 + d2;
            
            let winAmount = 0;
            let message = '';
            
            // Verificar vitória baseado no tipo de aposta
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
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📱 Login: https://nexus-trade-app1.onrender.com/login`);
    console.log(`👤 Cadastro: https://nexus-trade-app1.onrender.com/cadastro`);
    console.log(`⚙️ Admin: https://nexus-trade-app1.onrender.com/admin`);
    console.log(`🖼️ QR Code estático: /images/pix-nexus.png`);
});