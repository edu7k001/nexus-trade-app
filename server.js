const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ===== ROTAS DA API =====
app.get('/api/teste', (req, res) => {
    res.json({ mensagem: 'API FUNCIONANDO!' });
});

app.post('/api/login', (req, res) => {
    const { email } = req.body;
    res.json({
        success: true,
        user: { id: 1, name: 'Teste', email, balance: 1000, bonus_balance: 0 },
        redirect: '/dashboard.html'
    });
});

app.post('/api/register', (req, res) => {
    res.json({ success: true });
});

app.get('/api/user/:id/balance', (req, res) => {
    res.json({ balance: 1000, bonus_balance: 0 });
});

// ===== ROTAS DE PÁGINAS =====
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/admin-login.html', (req, res) => res.sendFile(path.join(__dirname, 'admin-login.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
