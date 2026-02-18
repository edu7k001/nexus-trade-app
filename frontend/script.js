document.addEventListener('DOMContentLoaded', () => {
    // CONFIGURAÇÃO - URL DO RENDER (CORRIGIDA!)
    const API_URL = 'https://nexus-trade-app.onrender.com/api';
    
    // Variáveis globais
    let userData = { name: '', pix: '', balance: 0, status: 'Pendente' };

    // Elementos do DOM
    const steps = {
        register: document.getElementById('step-register'),
        deposit: document.getElementById('step-deposit'),
        game: document.getElementById('step-game'),
        admin: document.getElementById('step-admin')
    };
    
    const registerForm = document.getElementById('register-form');
    const qrcodeContainer = document.getElementById('qrcode');
    const pixKeyDisplay = document.getElementById('pix-key-display');
    const btnConfirmDeposit = document.getElementById('btn-confirm-deposit');
    const displayName = document.getElementById('display-name');
    const balanceDisplay = document.getElementById('balance');
    const betAmountInput = document.getElementById('bet-amount');
    const btnUp = document.getElementById('btn-up');
    const btnDown = document.getElementById('btn-down');
    const gameResult = document.getElementById('game-result');
    const btnWithdraw = document.getElementById('btn-withdraw');
    const btnShowWithdraws = document.getElementById('btn-show-withdraws');
    const withdrawList = document.getElementById('withdraw-list');

    // Mostrar apenas uma etapa
    function showStep(stepName) {
        Object.values(steps).forEach(step => step.classList.remove('active'));
        steps[stepName].classList.add('active');
    }

    // Atualizar saldo na tela
    function updateBalance() {
        balanceDisplay.textContent = `R$ ${userData.balance.toFixed(2)}`;
    }

    // ===== CADASTRO =====
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('user-name').value;
        const pix = document.getElementById('user-pix').value;
        
        if (!name || !pix) {
            alert('Preencha todos os campos!');
            return;
        }
        
        try {
            const response = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, pixKey: pix })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                userData = { name, pix, balance: 0, status: 'Pendente' };
                showStep('deposit');
                loadPixQrCode();
            } else {
                alert(data.error || 'Erro no cadastro');
            }
        } catch (error) {
            alert('Erro de conexão com o servidor');
        }
    });

    // ===== DEPÓSITO =====
    async function loadPixQrCode() {
        try {
            const response = await fetch(`${API_URL}/pix-qrcode`);
            const data = await response.json();
            
            if (response.ok) {
                qrcodeContainer.innerHTML = '';
                new QRCode(qrcodeContainer, {
                    text: data.pixKey,
                    width: 200,
                    height: 200
                });
                pixKeyDisplay.textContent = data.pixKey;
            } else {
                gameResult.innerHTML = `<p class="lose">⚠️ ${data.error}</p>`;
            }
        } catch (error) {
            gameResult.innerHTML = '<p class="lose">⚠️ Erro ao carregar QR Code</p>';
        }
    }

    btnConfirmDeposit.addEventListener('click', async () => {
        gameResult.innerHTML = '<p style="color: #fd7e14;">⏳ Verificando depósito...</p>';
        
        try {
            const response = await fetch(`${API_URL}/confirm-deposit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pixKey: userData.pix })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                userData.balance = data.newBalance;
                userData.status = 'Ativo';
                displayName.textContent = userData.name;
                updateBalance();
                showStep('game');
                gameResult.innerHTML = `<p class="win">✅ ${data.message}</p>`;
            } else {
                gameResult.innerHTML = `<p class="lose">❌ ${data.error}</p>`;
            }
        } catch (error) {
            gameResult.innerHTML = '<p class="lose">❌ Erro ao confirmar depósito</p>';
        }
    });

    // ===== JOGO =====
    async function fazerAposta(direcao) {
        const amount = parseFloat(betAmountInput.value);
        
        if (userData.status !== 'Ativo') {
            gameResult.innerHTML = '<p class="lose">⚠️ Você precisa confirmar seu depósito</p>';
            return;
        }
        
        if (isNaN(amount) || amount < 5) {
            gameResult.innerHTML = '<p class="lose">⚠️ Aposta mínima: R$5</p>';
            return;
        }
        
        if (amount > userData.balance) {
            gameResult.innerHTML = '<p class="lose">❌ Saldo insuficiente!</p>';
            return;
        }
        
        gameResult.innerHTML = '<p style="color: #58a6ff;">⏳ Processando...</p>';
        
        try {
            const response = await fetch(`${API_URL}/bet`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pixKey: userData.pix, amount })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                userData.balance = data.newBalance;
                updateBalance();
                gameResult.innerHTML = `
                    <p class="lose">😢 ${data.message}</p>
                    <p style="font-size: 0.9em;">Tente novamente!</p>
                `;
            } else {
                gameResult.innerHTML = `<p class="lose">❌ ${data.error}</p>`;
            }
        } catch (error) {
            gameResult.innerHTML = '<p class="lose">❌ Erro na aposta</p>';
        }
    }

    btnUp.addEventListener('click', () => fazerAposta('up'));
    btnDown.addEventListener('click', () => fazerAposta('down'));

    // ===== SAQUE =====
    btnWithdraw.addEventListener('click', async () => {
        const amount = userData.balance;
        
        if (amount < 150) {
            alert('Saque mínimo: R$150');
            return;
        }
        
        if (!confirm(`Solicitar saque de R$ ${amount.toFixed(2)}?`)) {
            return;
        }
        
        try {
            const response = await fetch(`${API_URL}/request-withdraw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pixKey: userData.pix, amount })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                alert('✅ Saque solicitado! Aguarde aprovação.');
            } else {
                alert(`❌ ${data.error}`);
            }
        } catch (error) {
            alert('❌ Erro ao solicitar saque');
        }
    });

    // ===== ADMIN =====
    btnShowWithdraws.addEventListener('click', async () => {
        const senha = prompt('Digite a senha de admin:');
        
        if (!senha) return;
        
        try {
            const response = await fetch(`${API_URL}/admin/withdraws`, {
                headers: { 'Authorization': `Bearer ${senha}` }
            });
            
            const data = await response.json();
            
            if (response.ok) {
                if (data.length === 0) {
                    withdrawList.innerHTML = '<p>Nenhum saque pendente</p>';
                    return;
                }
                
                withdrawList.innerHTML = data.map(w => `
                    <div class="withdraw-item">
                        <h4>💰 Saque de R$ ${w.amount.toFixed(2)}</h4>
                        <p><strong>Nome:</strong> ${w.name}</p>
                        <p><strong>PIX:</strong> ${w.pix_key}</p>
                        <p><strong>Data:</strong> ${new Date(w.created_at).toLocaleString()}</p>
                        <div class="actions">
                            <button class="btn-approve" onclick="handleWithdraw(${w.id}, 'approve')">✅ APROVAR</button>
                            <button class="btn-reject" onclick="handleWithdraw(${w.id}, 'reject')">❌ REJEITAR</button>
                        </div>
                    </div>
                `).join('');
            } else {
                alert('Senha incorreta!');
            }
        } catch (error) {
            alert('Erro ao carregar saques');
        }
    });

    // Animação do preço (só visual)
    let price = 100;
    setInterval(() => {
        if (steps.game.classList.contains('active')) {
            const variation = (Math.random() * 2 - 1).toFixed(2);
            price = (price + parseFloat(variation)).toFixed(2);
            document.getElementById('price-value').textContent = `R$ ${price}`;
        }
    }, 3000);
});

// Função global para admin
async function handleWithdraw(id, action) {
    const senha = prompt('Confirme a senha de admin:');
    if (!senha) return;
    
    const API_URL = 'https://nexus-trade-app.onrender.com/api';
    
    try {
        const response = await fetch(`${API_URL}/admin/withdraw/${id}/${action}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${senha}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert(data.message);
            document.getElementById('btn-show-withdraws').click();
        } else {
            alert('Erro ao processar');
        }
    } catch (error) {
        alert('Erro de conexão');
    }
}