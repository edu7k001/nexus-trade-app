const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const path = require('path');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3001;

// Configurações
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
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
        proof_image TEXT,
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

// ===== ROTA DO QR CODE (CORRIGIDA) =====
app.get('/api/pix-qrcode', async (req, res) => {
    try {
        db.get('SELECT pix_key FROM admin_config WHERE id = 1', async (err, row) => {
            if (err) {
                console.error('Erro ao buscar chave PIX:', err);
                return res.status(500).json({ error: 'Erro ao acessar banco de dados' });
            }
            
            if (!row || !row.pix_key) {
                return res.status(404).json({ error: 'Chave PIX não configurada' });
            }
            
            // Gera o QR Code
            const qrCodeDataUrl = await QRCode.toDataURL(row.pix_key, {
                errorCorrectionLevel: 'H',
                type: 'image/png',
                quality: 0.92,
                margin: 1,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            });
            
            console.log('✅ QR Code gerado para chave:', row.pix_key);
            
            res.json({ 
                success: true,
                qrcode: qrCodeDataUrl, 
                pixKey: row.pix_key,
                message: 'QR Code gerado com sucesso!' 
            });
        });
    } catch (error) {
        console.error('Erro ao gerar QR Code:', error);
        res.status(500).json({ error: 'Erro ao gerar QR Code' });
    }
});

// ===== ROTAS DE AUTENTICAÇÃO =====

// Registro
app.post('/api/register', async (req, res) => {
    const { name, email, password, pixKey } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
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
                    console.error('Erro no cadastro:', err);
                    return res.status(500).json({ error: 'Erro no cadastro' });
                }
                res.status(201).json({ 
                    id: this.lastID,
                    message: 'Cadastro realizado com sucesso!' 
                });
            }
        );
    } catch (error) {
        console.error('Erro interno:', error);
        res.status(500).json({ error: 'Erro interno' });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email e senha obrigatórios' });
    }
    
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err) {
            console.error('Erro no login:', err);
            return res.status(500).json({ error: 'Erro no servidor' });
        }
        
        if (!user) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }
        
        // Não enviar a senha
        delete user.password;
        res.json({ 
            user,
            message: 'Login realizado com sucesso' 
        });
    });
});

// ===== ROTAS DE DEPÓSITO =====

// Solicitar depósito
app.post('/api/request-deposit', (req, res) => {
    const { userId, amount, proofImage } = req.body;
    
    if (!userId || !amount) {
        return res.status(400).json({ error: 'Dados incompletos' });
    }
    
    db.run('INSERT INTO deposits (user_id, amount, proof_image) VALUES (?, ?, ?)',
        [userId, amount, proofImage || ''],
        function(err) {
            if (err) {
                console.error('Erro ao solicitar depósito:', err);
                return res.status(500).json({ error: 'Erro ao solicitar depósito' });
            }
            res.json({ 
                message: '✅ Depósito solicitado! Aguarde confirmação do admin.',
                depositId: this.lastID
            });
        }
    );
});

// ===== ROTAS DO ADMIN =====

// Middleware de autenticação do admin
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
            if (err || !admin) {
                return res.status(401).json({ error: 'Não autorizado' });
            }
            
            const validPassword = await bcrypt.compare(password, admin.password);
            if (!validPassword) {
                return res.status(401).json({ error: 'Não autorizado' });
            }
            
            req.admin = admin;
            next();
        });
    } catch (error) {
        return res.status(401).json({ error: 'Não autorizado' });
    }
};

// Listar depósitos pendentes
app.get('/api/admin/deposits', checkAdmin, (req, res) => {
    const sql = `
        SELECT d.*, u.name, u.email, u.pix_key 
        FROM deposits d 
        JOIN users u ON d.user_id = u.id 
        WHERE d.status = 'Pendente'
        ORDER BY d.created_at DESC
    `;
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar depósitos:', err);
            return res.status(500).json({ error: 'Erro ao buscar depósitos' });
        }
        res.json(rows);
    });
});

// Confirmar depósito
app.post('/api/admin/confirm-deposit/:id', checkAdmin, (req, res) => {
    const { id } = req.params;
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Valor inválido' });
    }
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.get('SELECT user_id FROM deposits WHERE id = ?', [id], (err, deposit) => {
            if (err || !deposit) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Depósito não encontrado' });
            }
            
            db.run('UPDATE deposits SET status = "Confirmado" WHERE id = ?', [id], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Erro ao confirmar depósito' });
                }
                
                db.run('UPDATE users SET balance = balance + ?, status = "Ativo" WHERE id = ?',
                    [amount, deposit.user_id],
                    function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Erro ao creditar' });
                        }
                        
                        db.run('COMMIT');
                        res.json({ 
                            message: '✅ Depósito confirmado! Saldo adicionado.',
                            amount
                        });
                    }
                );
            });
        });
    });
});

// Rejeitar depósito
app.post('/api/admin/reject-deposit/:id', checkAdmin, (req, res) => {
    const { id } = req.params;
    
    db.run('UPDATE deposits SET status = "Rejeitado" WHERE id = ?', [id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Erro ao rejeitar depósito' });
        }
        res.json({ message: 'Depósito rejeitado' });
    });
});

// Listar saques pendentes
app.get('/api/admin/withdraws', checkAdmin, (req, res) => {
    const sql = `
        SELECT wr.*, u.name, u.email, u.pix_key 
        FROM withdraw_requests wr 
        JOIN users u ON wr.user_id = u.id 
        WHERE wr.status = 'Pendente'
        ORDER BY wr.created_at DESC
    `;
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao buscar saques' });
        }
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
                [withdraw.amount, withdraw.user_id],
                function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Erro ao debitar saldo' });
                    }
                    
                    db.run('UPDATE withdraw_requests SET status = "Aprovado" WHERE id = ?', [id], function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Erro ao aprovar saque' });
                        }
                        
                        db.run('COMMIT');
                        res.json({ message: 'Saque aprovado com sucesso!' });
                    });
                }
            );
        });
    });
});

// Rejeitar saque
app.post('/api/admin/withdraw/:id/reject', checkAdmin, (req, res) => {
    const { id } = req.params;
    
    db.run('UPDATE withdraw_requests SET status = "Rejeitado" WHERE id = ?', [id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Erro ao rejeitar saque' });
        }
        res.json({ message: 'Saque rejeitado!' });
    });
});

// ===== ROTAS DO USUÁRIO =====

// Buscar dados do usuário
app.get('/api/user/:id', (req, res) => {
    db.get('SELECT id, name, email, pix_key, balance, status, created_at FROM users WHERE id = ?',
        [req.params.id],
        (err, user) => {
            if (err || !user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }
            res.json(user);
        }
    );
});

// Solicitar saque
app.post('/api/request-withdraw', (req, res) => {
    const { userId, amount } = req.body;
    
    if (!userId || !amount) {
        return res.status(400).json({ error: 'Dados incompletos' });
    }
    
    db.get('SELECT balance FROM users WHERE id = ?', [userId], (err, user) => {
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
                [userId, amount],
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

// Rota de teste
app.get('/api/test', (req, res) => {
    res.json({ message: 'API funcionando!', timestamp: new Date().toISOString() });
});

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📱 Acesse: https://nexus-trade-app1.onrender.com`);
    console.log(`💰 Teste o QR Code: https://nexus-trade-app1.onrender.com/api/pix-qrcode`);
});