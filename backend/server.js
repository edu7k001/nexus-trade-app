const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Servir arquivos estáticos da pasta frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Rota de teste da API
app.get('/api/teste', (req, res) => {
    res.json({ 
        success: true, 
        mensagem: '✅ Servidor funcionando!',
        timestamp: new Date().toISOString()
    });
});

// Rota de login simples (sempre funciona para teste)
app.post('/api/login', (req, res) => {
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
});

// Para qualquer outra rota, redireciona para o frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📁 Servindo arquivos de: ${path.join(__dirname, '../frontend')}`);
});
