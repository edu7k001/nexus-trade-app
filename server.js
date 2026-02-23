const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname)));

// Rota de teste da API
app.get('/api/teste', (req, res) => {
    res.json({ 
        success: true, 
        mensagem: '✅ API MEGABET777 funcionando!',
        timestamp: new Date().toISOString()
    });
});

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota admin
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log('===============================');
    console.log('🚀 MEGABET777 - SERVIDOR ATIVO');
    console.log('===============================');
    console.log(`📡 Porta: ${PORT}`);
    console.log(`✅ Status: Online`);
    console.log('===============================');
});
