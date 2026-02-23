const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Erro no banco:', err);
    else {
        console.log('✅ Banco conectado');
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
                bonus_balance REAL DEFAULT 0
            );
        `);
        const adminEmail = 'edu7k001@gmail.com';
        const adminPass = bcrypt.hashSync('@Carlos1998', 10);
        db.run('INSERT OR IGNORE INTO admins (email, password) VALUES (?, ?)', [adminEmail, adminPass]);
    }
});

app.get('/api/teste', (req, res) => res.json({ mensagem: 'API funcionando!' }));

app.post('/api/admin-login', (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM admins WHERE email = ?', [email], (err, admin) => {
        if (!admin || !bcrypt.compareSync(password, admin.password)) 
            return res.status(401).json({ erro: 'Credenciais inválidas' });
        res.json({ success: true });
    });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password))
            return res.status(401).json({ erro: 'Credenciais inválidas' });
        res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, balance: user.balance, bonus_balance: user.bonus_balance }, redirect: '/dashboard.html' });
    });
});

app.post('/api/register', (req, res) => {
    const { name, email, password } = req.body;
    const hashed = bcrypt.hashSync(password, 10);
    db.run('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name, email, hashed], function(err) {
        if (err) return res.status(500).json({ erro: 'Email já existe' });
        res.json({ success: true });
    });
});

app.get('/api/user/:id/balance', (req, res) => {
    db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [req.params.id], (err, user) => {
        if (!user) return res.status(404).json({ erro: 'Usuário não encontrado' });
        res.json(user);
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin-login.html', (req, res) => res.sendFile(path.join(__dirname, 'admin-login.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
