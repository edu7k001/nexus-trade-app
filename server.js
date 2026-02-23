const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Banco de dados
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Erro no banco:', err);
    else {
        console.log('✅ Banco de dados conectado');
        
        // Criar tabela de admin
        db.run(`CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )`);
        
        // Criar admin padrão (edu7k001@gmail.com / @Carlos1998)
        const adminEmail = 'edu7k001@gmail.com';
        const adminPassword = bcrypt.hashSync('@Carlos1998', 10);
        
        db.get('SELECT * FROM admins WHERE email = ?', [adminEmail], (err, admin) => {
            if (!admin) {
                db.run('INSERT INTO admins (email, password) VALUES (?, ?)',
                    [adminEmail, adminPassword]);
                console.log('✅ Admin criado');
            }
        });
    }
});

// ==================== ROTAS ====================

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

// Página inicial
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Admin page
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Admin login page
app.get('/admin-login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-login.html'));
});

app.listen(PORT, () => {
    console.log('=================================');
    console.log('🚀 MEGABET777 - SERVIDOR ATIVO');
    console.log('=================================');
    console.log(`📡 Porta: ${PORT}`);
    console.log(`👑 Admin: edu7k001@gmail.com`);
    console.log('=================================');
});
