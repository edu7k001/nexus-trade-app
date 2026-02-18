document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURAÇÃO ---
    // Em produção, esta URL será a do seu site no Render
    const API_URL = window.location.origin.replace(/^http/, 'http') + '/api';

    // --- VARIÁVEIS GLOBAIS ---
    let userData = { name: '', pix: '', balance: 0, status: 'Pendente' };

    // --- ELEMENTOS DO DOM ---
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

    // --- ELEMENTOS DO ADMIN ---
    const btnShowWithdraws = document.getElementById('btn-show-withdraws');
    const withdrawList = document.getElementById('withdraw-list');

    // --- FUNÇÕES DE NAVEGAÇÃO ---
    function showStep(stepName) {
        Object.values(steps).forEach(step => step.classList.remove('active'));
        steps[stepName].classList.add('active');
    }

    // --- FLUXO DE CADASTRO ---
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        userData.name = document.getElementById('user-name').value;
        userData.pix = document.getElementById('user-pix').value;
        if (userData.name && userData.pix) {
            const response = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: userData.name, pixKey: userData.pix })
            });
            if (response.ok) {
                showStep('deposit');
                await loadPixQrCode();
            } else {
                const error = await response.json();
                alert(error.error || 'Erro no cadastro.');
            }
        }
    });

    // --- FLUXO DE DEPÓSITO ---
    async function loadPixQrCode() {
        const response = await fetch(`${API_URL}/pix-qrcode`);
        const data = await response.json();
        if (response.ok) {
            qrcodeContainer.innerHTML = ''; // Limpa QR Code anterior
            new QRCode(qrcodeContainer, { text: data.pixKey, width: 200, height: 200 });
            pixKeyDisplay.textContent = data.pixKey;
        } else {
            gameResult.innerHTML = `<p class="lose">Erro: \${data.error}</p>`;
        }
    }

    btnConfirmDeposit.addEventListener('click', async () => {
        gameResult.innerHTML = `<p style="color: #fd7e14;">Verificando seu depósito... Aguarde.</p>`;
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
            gameResult.innerHTML = `<p class="win">${data.message}</p>`;
        } else {
            gameResult.innerHTML = `<p class="lose">Erro: \${data.error}</p>`;
        }
    });

    // --- FLUXO DO JOGO ---
    function updateBalance() {
        balanceDisplay.textContent = `$${userData.balance.toFixed(2)}__PROTECTED_11__<p class="lose">Você precisa confirmar seu depósito.</p>__PROTECTED_12__<p class="lose">Aposta inválida.</p>__PROTECTED_13__<p class="lose">Saldo insuficiente!</p>__PROTECTED_14__<p style="color: #58a6ff;">Analisando mercado...</p>__PROTECTED_15__${API_URL}/bet__PROTECTED_16__<p class="lose">${data.message}</p>__PROTECTED_17__<p style="font-size: 0.9em; color: #8b949e;">Recupere na próxima!</p>__PROTECTED_18__<p class="lose">Erro: ${data.error}</p>__PROTECTED_19__${API_URL}/request-withdraw__PROTECTED_20__<p style="color: #58a6ff;">${data.message}</p>__PROTECTED_21__<p class="lose">Erro: ${data.error}</p>__PROTECTED_22__${API_URL}/admin/withdraws__PROTECTED_23__Bearer ${ADMIN_PASSWORD}__PROTECTED_24__
                        <div class="withdraw-item">
                            <h4>Saque de $${w.amount.toFixed(2)}</h4>
                            <p>Nome: \${w.name}</p>
                            <p>PIX: \${w.pix_key}</p>
                            <div class="actions">
                                <button class="btn-approve" onclick="handleWithdraw(\${w.id}, 'approve')">APROVAR</button>
                                <button class="btn-reject" onclick="handleWithdraw(\${w.id}, 'reject')">REJEITAR</button>
                            </div>
                        </div>
                    `;
                });
            }
        } else {
            withdrawList.innerHTML = '<p>Erro ao carregar saques.</p>';
        }
    });
});

// Função global para ser chamada pelo onclick do HTML
async function handleWithdraw(id, action) {
    const API_URL = window.location.origin.replace(/^http/, 'http') + '/api';
    const ADMIN_PASSWORD = 'senha123';

    const response = await fetch(`${API_URL}/admin/withdraw/${id}/${action}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ADMIN_PASSWORD}` }
    });
    const data = await response.json();
    if (response.ok) {
        alert(data.message);
        // Recarrega a lista de saques para atualizar
        document.getElementById('btn-show-withdraws').click();
    } else {
        alert('Erro ao processar ação.');
    }
}

// Animação simples do gráfico de preços
setInterval(() => {
    const priceValue = document.getElementById('price-value');