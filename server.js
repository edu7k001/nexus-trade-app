const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware para processar JSON
app.use(express.json());
// Servir arquivos estáticos da raiz
app.use(express.static(path.join(__dirname)));

// ==================== ROTAS DA API ====================
app.get('/api/teste', (req, res) => {
    res.json({ sucesso: true, mensagem: 'API funcionando!' });
});

app.post('/api/login', (req, res) => {
    const { email } = req.body;
    // Aceita qualquer login para teste
    res.json({
        sucesso: true,
        usuario: { id: 1, nome: 'Teste', email, saldo: 1000, bonus: 0 },
        redirecionar: '/dashboard.html'
    });
});

app.post('/api/register', (req, res) => {
    res.json({ sucesso: true });
});

app.get('/api/user/:id/balance', (req, res) => {
    res.json({ saldo: 1000, bonus: 0 });
});

// ==================== ROTAS DE PÁGINAS ====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/admin-login.html', (req, res) => res.sendFile(path.join(__dirname, 'admin-login.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
    console.log(`🔗 Teste a API em /api/teste`);
});
