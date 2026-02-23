const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname))); // serve todos os arquivos estáticos da raiz

// Banco de dados SQLite
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('❌ Erro ao conectar ao banco:', err);
    else {
        console.log('✅ Banco de dados conectado.');
        // Cria tabelas
        db.exec(`
            CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT
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
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS deposits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                bonus REAL DEFAULT 0,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS withdraws (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                pix_key TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
        `);

        // Inserir admin padrão (edu7k001@gmail.com / @Carlos1998)
        const adminEmail = 'edu7k001@gmail.com';
        const adminPassword = bcrypt.hashSync('@Carlos1998', 10);
        db.get('SELECT * FROM admins WHERE email = ?', [adminEmail], (err, row) => {
            if (!row) {
                db.run('INSERT INTO admins (email, password, name) VALUES (?, ?, ?)',
                    [adminEmail, adminPassword, 'Administrador']);
                console.log('✅ Admin criado: edu7k001@gmail.com');
            }
        });

        // Inserir configurações de jogos (opcional)
        const games = [
            ['fortune-ox', 96.75, 5, 1000],
            ['fortune-tiger', 96.75, 5, 1000],
            ['fortune-mouse', 96.75, 5, 1000],
            ['tumble', 97, 5, 1000],
            ['slots', 95, 5, 1000],
            ['dice', 95, 5, 500],
            ['crash', 95, 5, 5000],
            ['roulette', 95, 5, 1000],
            ['blackjack', 95, 5, 1000]
        ];
        games.forEach(game => {
            db.run('INSERT OR IGNORE INTO games (name, rtp, min_bet, max_bet) VALUES (?, ?, ?, ?)',
                game);
        });
    }
});

// ==================== ROTAS PÚBLICAS ====================

// Rota de teste da API
app.get('/api/teste', (req, res) => {
    res.json({ success: true, message: '✅ API funcionando!', timestamp: new Date() });
});

// ==================== ROTAS DE ADMIN ====================

// Login admin
app.post('/api/admin-login', (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM admins WHERE email = ?', [email], (err, admin) => {
        if (!admin || !bcrypt.compareSync(password, admin.password)) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        res.json({ success: true, admin: { email: admin.email, name: admin.name } });
    });
});

// Estatísticas do admin (simplificadas)
app.get('/api/admin/stats', (req, res) => {
    db.get('SELECT COUNT(*) as total_users FROM users', (err, users) => {
        db.get('SELECT COUNT(*) as pending_deposits FROM deposits WHERE status="pending"', (err, deposits) => {
            db.get('SELECT COUNT(*) as pending_withdraws FROM withdraws WHERE status="pending"', (err, withdraws) => {
                res.json({
                    total_users: users?.total_users || 0,
                    pending_deposits: deposits?.pending_deposits || 0,
                    pending_withdraws: withdraws?.pending_withdraws || 0,
                    total_balance: 0,
                    online_users: 0
                });
            });
        });
    });
});

// Listar usuários (admin)
app.get('/api/admin/users', (req, res) => {
    db.all('SELECT id, name, email, balance, bonus_balance, rollover, status, rtp_individual FROM users', [], (err, users) => {
        res.json(users || []);
    });
});

// Atualizar usuário
app.post('/api/admin/user/:id/update', (req, res) => {
    const { id } = req.params;
    const { balance, bonus_balance, rollover, status, rtp_individual } = req.body;
    db.run(
        'UPDATE users SET balance = ?, bonus_balance = ?, rollover = ?, status = ?, rtp_individual = ? WHERE id = ?',
        [balance, bonus_balance, rollover, status, rtp_individual, id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Depósitos pendentes
app.get('/api/admin/deposits', (req, res) => {
    db.all('SELECT d.*, u.name FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.status="pending"', [], (err, deposits) => {
        res.json(deposits || []);
    });
});

// Confirmar depósito
app.post('/api/admin/confirm-deposit/:id', (req, res) => {
    const { id } = req.params;
    const { amount, bonus } = req.body;
    db.get('SELECT user_id FROM deposits WHERE id = ?', [id], (err, deposit) => {
        if (!deposit) return res.status(404).json({ error: 'Depósito não encontrado' });
        db.run('UPDATE users SET balance = balance + ?, bonus_balance = bonus_balance + ? WHERE id = ?',
            [amount, bonus, deposit.user_id]);
        db.run('UPDATE deposits SET status = "confirmed" WHERE id = ?', [id]);
        res.json({ success: true });
    });
});

// Saques pendentes
app.get('/api/admin/withdraws', (req, res) => {
    db.all('SELECT w.*, u.name FROM withdraws w JOIN users u ON w.user_id = u.id WHERE w.status="pending"', [], (err, withdraws) => {
        res.json(withdraws || []);
    });
});

// Aprovar saque
app.post('/api/admin/approve-withdraw/:id', (req, res) => {
    const { id } = req.params;
    db.run('UPDATE withdraws SET status="approved" WHERE id=?', [id]);
    res.json({ success: true });
});

// Rejeitar saque (devolve saldo)
app.post('/api/admin/reject-withdraw/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT user_id, amount FROM withdraws WHERE id=?', [id], (err, w) => {
        if (w) {
            db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [w.amount, w.user_id]);
            db.run('UPDATE withdraws SET status="rejected" WHERE id=?', [id]);
        }
        res.json({ success: true });
    });
});

// Listar jogos (admin)
app.get('/api/admin/games', (req, res) => {
    db.all('SELECT * FROM games', [], (err, games) => {
        res.json(games || []);
    });
});

// Salvar configuração de jogo
app.post('/api/admin/game/:name', (req, res) => {
    const { name } = req.params;
    const { rtp, min_bet, max_bet, active } = req.body;
    db.run('UPDATE games SET rtp=?, min_bet=?, max_bet=?, active=? WHERE name=?',
        [rtp, min_bet, max_bet, active, name],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// ==================== ROTAS DE USUÁRIO ====================

// Registro
app.post('/api/register', (req, res) => {
    const { name, email, password } = req.body;
    const hashed = bcrypt.hashSync(password, 10);
    db.run('INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
        [name, email, hashed],
        function(err) {
            if (err) return res.status(500).json({ error: 'Email já cadastrado' });
            res.json({ success: true, id: this.lastID });
        }
    );
});

// Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password))
            return res.status(401).json({ error: 'Credenciais inválidas' });
        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                balance: user.balance,
                bonus_balance: user.bonus_balance
            },
            redirect: '/dashboard.html'
        });
    });
});

// Saldo do usuário
app.get('/api/user/:id/balance', (req, res) => {
    db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [req.params.id], (err, user) => {
        if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
        res.json(user);
    });
});

// Solicitar depósito
app.post('/api/request-deposit', (req, res) => {
    const { user_id, amount } = req.body;
    db.run('INSERT INTO deposits (user_id, amount) VALUES (?, ?)', [user_id, amount], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

// Solicitar saque
app.post('/api/request-withdraw', (req, res) => {
    const { user_id, amount, pix_key } = req.body;
    db.get('SELECT balance FROM users WHERE id=?', [user_id], (err, user) => {
        if (user.balance < amount) return res.status(400).json({ error: 'Saldo insuficiente' });
        db.run('UPDATE users SET balance = balance - ? WHERE id=?', [amount, user_id]);
        db.run('INSERT INTO withdraws (user_id, amount, pix_key) VALUES (?, ?, ?)',
            [user_id, amount, pix_key]);
        res.json({ success: true });
    });
});

// ==================== ROTAS DE JOGO (exemplo Fortune Ox) ====================
app.post('/api/game/fortune-ox', (req, res) => {
    const { userId, betAmount } = req.body;
    db.get('SELECT * FROM games WHERE name="fortune-ox"', (err, game) => {
        if (!game || !game.active) return res.status(400).json({ error: 'Jogo indisponível' });
        db.get('SELECT * FROM users WHERE id=?', [userId], (err, user) => {
            if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
            const total = user.balance + user.bonus_balance;
            if (total < betAmount) return res.status(400).json({ error: 'Saldo insuficiente' });

            // Lógica simples do jogo (apenas demonstração)
            const symbols = ['🐂', '🪙', '🧧', '💰', '🧨', '🍊', '🎆'];
            const result = [
                symbols[Math.floor(Math.random() * 7)],
                symbols[Math.floor(Math.random() * 7)],
                symbols[Math.floor(Math.random() * 7)]
            ];
            let winAmount = 0;
            if (result[0] === result[1] && result[1] === result[2]) {
                winAmount = betAmount * 5;
                if (result[0] === '🐂') winAmount = betAmount * 20;
            }
            // Aplica RTP
            winAmount = Math.floor(winAmount * (game.rtp / 100));

            // Processa saldo (usando bônus primeiro)
            let newBalance = user.balance;
            let newBonus = user.bonus_balance;
            if (user.bonus_balance >= betAmount) {
                newBonus -= betAmount;
            } else {
                newBalance -= (betAmount - user.bonus_balance);
                newBonus = 0;
            }
            if (winAmount > 0) newBalance += winAmount;

            db.run('UPDATE users SET balance=?, bonus_balance=? WHERE id=?', [newBalance, newBonus, userId]);
            res.json({ success: true, result, winAmount, newBalance: newBalance + newBonus });
        });
    });
});

// ==================== SERVIÇO DE PÁGINAS ====================
app.get('/:page.html', (req, res) => {
    const page = req.params.page;
    const file = path.join(__dirname, `${page}.html`);
    res.sendFile(file, err => {
        if (err) res.status(404).sendFile(path.join(__dirname, 'index.html'));
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`\n=================================`);
    console.log(`🚀 MEGABET777 rodando na porta ${PORT}`);
    console.log(`📁 Servindo arquivos da raiz`);
    console.log(`👑 Admin: edu7k001@gmail.com / @Carlos1998`);
    console.log(`=================================\n`);
});
