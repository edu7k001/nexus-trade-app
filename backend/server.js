const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// SERVE OS ARQUIVOS DA PASTA FRONTEND (CORRIGIDO)
app.use(express.static(path.join(__dirname, '../frontend')));

// Rota de teste
app.get('/api/teste', (req, res) => {
    res.json({ 
        success: true, 
        message: '✅ API funcionando!',
        timestamp: new Date().toISOString()
    });
});

// Rota de login admin (simples para teste)
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    if (email === 'admin@nexus.com' && password === 'admin123') {
        res.json({
            success: true,
            user: {
                id: 1,
                name: 'Admin',
                email: 'admin@nexus.com',
                is_admin: 1
            },
            redirect: '/admin.html'
        });
    } else {
        res.status(401).json({ error: 'Credenciais inválidas' });
    }
});

// Rota para servir qualquer arquivo HTML (CORRIGIDO)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
