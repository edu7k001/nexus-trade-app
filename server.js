const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3001;

// ==================== MIDDLEWARES ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname))); // serve arquivos estáticos da raiz

// ==================== BANCO DE DADOS ====================
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
    `, (err) => {
        if (err) {
            console.error('❌ Erro ao criar tabelas:', err);
        } else {
            console.log('✅ Tabelas verificadas/criadas.');
            // Inserir admin padrão se não existir
            const adminEmail = 'edu7k001@gmail.com';
            const adminPassword = bcrypt.hashSync('@Carlos1998', 10);
            db.get('SELECT * FROM admins WHERE email = ?', [adminEmail], (err, admin) => {
                if (!admin) {
                    db.run('INSERT INTO admins (email, password, name) VALUES (?, ?, ?)',
                        [adminEmail, adminPassword, 'Administrador']);
                    console.log('✅ Admin padrão criado.');
                }
            });
            // Inserir configurações de jogos padrão
            const jogos = [
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
            jogos.forEach(jogo => {
                db.run('INSERT OR IGNORE INTO games (name, rtp, min_bet, max_bet) VALUES (?, ?, ?, ?)', jogo);
            });
        }
    });
}

// ==================== FUNÇÕES AUXILIARES ====================
function gerarResultadoFortuneOx() {
    const symbols = ['🐂', '🪙', '🧧', '💰', '🧨', '🍊', '🎆'];
    return [
        symbols[Math.floor(Math.random() * symbols.length)],
        symbols[Math.floor(Math.random() * symbols.length)],
        symbols[Math.floor(Math.random() * symbols.length)]
    ];
}

function calcularGanhoFortuneOx(resultado, aposta, rtp) {
    let win = 0;
    if (resultado[0] === resultado[1] && resultado[1] === resultado[2]) {
        if (resultado[0] === '🐂') win = aposta * 20;
        else win = aposta * 5;
    }
    return Math.floor(win * (rtp / 100));
}

// ==================== ROTAS PÚBLICAS ====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/admin-login.html', (req, res) => res.sendFile(path.join(__dirname, 'admin-login.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/fortune-ox.html', (req, res) => res.sendFile(path.join(__dirname, 'fortune-ox.html')));

// ==================== ROTAS DE API ====================

// Teste
app.get('/api/teste', (req, res) => {
    res.json({ success: true, message: 'API funcionando perfeitamente!' });
});

// Registro de usuário
app.post('/api/register', (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.run('INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
        [name, email, hashedPassword],
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

// Login de usuário
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        if (!bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
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
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
        res.json(user);
    });
});

// ==================== ROTAS ADMIN ====================
// (Para simplificar, usaremos autenticação básica por token – mas aqui manteremos simples com verificação fixa)

function checkAdmin(req, res, next) {
    // Numa implementação real, você usaria JWT. Por simplicidade, vamos verificar credenciais no header.
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

// Login admin (rota separada)
app.post('/api/admin-login', (req, res) => {
    const { email, password } = req.body;
    if (email === 'edu7k001@gmail.com' && password === '@Carlos1998') {
        return res.json({ success: true, admin: { email } });
    }
    res.status(401).json({ error: 'Credenciais inválidas' });
});

// Estatísticas do admin
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
                        online_users: 1 // simulação
                    });
                });
            });
        });
    });
});

// Listar usuários
app.get('/api/admin/users', checkAdmin, (req, res) => {
    db.all('SELECT id, name, email, balance, bonus_balance, rollover, status, rtp_individual FROM users', [], (err, users) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(users);
    });
});

// Atualizar usuário
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

// Depósitos pendentes
app.get('/api/admin/deposits', checkAdmin, (req, res) => {
    db.all('SELECT d.*, u.name FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.status = "pending"', [], (err, deposits) => {
        res.json(deposits);
    });
});

// Confirmar depósito
app.post('/api/admin/confirm-deposit/:id', checkAdmin, (req, res) => {
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
app.get('/api/admin/withdraws', checkAdmin, (req, res) => {
    db.all('SELECT w.*, u.name FROM withdraws w JOIN users u ON w.user_id = u.id WHERE w.status = "pending"', [], (err, withdraws) => {
        res.json(withdraws);
    });
});

// Aprovar saque
app.post('/api/admin/approve-withdraw/:id', checkAdmin, (req, res) => {
    const { id } = req.params;
    db.run('UPDATE withdraws SET status = "approved" WHERE id = ?', [id]);
    res.json({ success: true });
});

// Rejeitar saque (devolve saldo)
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

// Listar jogos (configurações)
app.get('/api/admin/games', checkAdmin, (req, res) => {
    db.all('SELECT * FROM games', [], (err, games) => {
        res.json(games);
    });
});

// Salvar configuração de um jogo
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

// ==================== ROTAS DE JOGOS ====================

// Fortune Ox
app.post('/api/game/fortune-ox', (req, res) => {
    const { userId, betAmount } = req.body;
    if (!userId || !betAmount || betAmount < 5) {
        return res.status(400).json({ error: 'Aposta inválida' });
    }

    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado' });

        const total = user.balance + user.bonus_balance;
        if (total < betAmount) {
            return res.status(400).json({ error: 'Saldo insuficiente' });
        }

        // Busca configuração do jogo
        db.get('SELECT * FROM games WHERE name = "fortune-ox"', (err, game) => {
            if (!game || !game.active) {
                return res.status(400).json({ error: 'Jogo indisponível' });
            }

            // Gera resultado e calcula ganho
            const resultado = gerarResultadoFortuneOx();
            const winAmount = calcularGanhoFortuneOx(resultado, betAmount, game.rtp);

            // Processa o saldo (usa bônus primeiro)
            let newBalance = user.balance;
            let newBonus = user.bonus_balance;

            if (user.bonus_balance >= betAmount) {
                newBonus -= betAmount;
            } else {
                newBalance -= (betAmount - user.bonus_balance);
                newBonus = 0;
            }

            if (winAmount > 0) {
                newBalance += winAmount;
            }

            // Atualiza banco de dados
            db.run('UPDATE users SET balance = ?, bonus_balance = ? WHERE id = ?',
                [newBalance, newBonus, userId], (err) => {
                    if (err) return res.status(500).json({ error: 'Erro ao atualizar saldo' });

                    // Registra histórico
                    db.run('INSERT INTO game_history (user_id, game, bet_amount, win_amount, result) VALUES (?, ?, ?, ?, ?)',
                        [userId, 'fortune-ox', betAmount, winAmount, winAmount > 0 ? 'win' : 'lose']);

                    res.json({
                        success: true,
                        result: resultado,
                        winAmount,
                        newBalance: newBalance + newBonus,
                        message: winAmount > 0 ? `🎉 Ganhou R$ ${winAmount.toFixed(2)}!` : `😢 Perdeu R$ ${betAmount.toFixed(2)}`
                    });
                }
            );
        });
    });
});

// ==================== INICIAR SERVIDOR ====================
app.listen(PORT, () => {
    console.log('\n=================================');
    console.log(`🚀 MEGABET777 rodando na porta ${PORT}`);
    console.log(`📁 Servindo arquivos da raiz`);
    console.log(`👑 Admin: edu7k001@gmail.com / @Carlos1998`);
    console.log(`🔗 Teste a API: /api/teste`);
    console.log('=================================\n');
});
