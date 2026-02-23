const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('❌ Erro no banco:', err);
    else console.log('✅ Banco de dados conectado');
});

// Criar tabelas
db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        balance REAL DEFAULT 0,
        bonus_balance REAL DEFAULT 0,
        status TEXT DEFAULT 'Ativo'
    );
`);

// Criar admin
const adminEmail = 'edu7k001@gmail.com';
const adminPassword = bcrypt.hashSync('@Carlos1998', 10);

db.get('SELECT * FROM admins WHERE email = ?', [adminEmail], (err, admin) => {
    if (!admin) {
        db.run('INSERT INTO admins (email, password) VALUES (?, ?)',
            [adminEmail, adminPassword]);
        console.log('✅ Admin criado');
    }
});

// ========== ROTAS API ==========

// Login admin
app.post('/api/admin-login', (req, res) => {
    const { email, password } = req.body;
    
    db.get('SELECT * FROM admins WHERE email = ?', [email], (err, admin) => {
        if (!admin || !bcrypt.compareSync(password, admin.password)) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        res.json({ success: true, admin: { email: admin.email } });
    });
});

// Estatísticas
app.get('/api/admin/stats', (req, res) => {
    db.get('SELECT COUNT(*) as total_users FROM users', (err, users) => {
        res.json({
            total_users: users?.total_users || 0,
            online_users: 1,
            total_balance: 15000,
            pending_deposits: 0,
            pending_withdraws: 0
        });
    });
});

// Listar usuários
app.get('/api/admin/users', (req, res) => {
    db.all('SELECT * FROM users', [], (err, users) => {
        res.json(users || []);
    });
});

// Listar depósitos
app.get('/api/admin/deposits', (req, res) => {
    res.json([]);
});

// Listar saques
app.get('/api/admin/withdraws', (req, res) => {
    res.json([]);
});

// Listar jogos
app.get('/api/admin/games', (req, res) => {
    res.json([
        { name: 'fortune-ox', rtp: 96.75, min_bet: 5, max_bet: 1000, active: 1 },
        { name: 'fortune-tiger', rtp: 96.75, min_bet: 5, max_bet: 1000, active: 1 },
        { name: 'tumble', rtp: 97, min_bet: 5, max_bet: 1000, active: 1 }
    ]);
});

// ========== ROTAS DE PÁGINAS ==========

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin-login.html', (req, res) => res.sendFile(path.join(__dirname, 'admin-login.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
