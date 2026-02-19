let userData = null;
let ws = null;
let highestBalance = 0;
let hasDeposited = localStorage.getItem('hasDeposited') === 'true';
let showFirstTimePopup = !localStorage.getItem('firstDepositShown') && !hasDeposited;
let selectedDepositAmount = null;

const fakeNames = ['João','Maria','Carlos','Ana','Pedro','Paula','Lucas','Fernanda','Rafael','Juliana'];

async function loadUserData() {
    const userStr = localStorage.getItem('user');
    if (!userStr) { window.location.href = '/login'; return; }
    userData = JSON.parse(userStr);
    try {
        const res = await fetch(`/api/user/${userData.id}`);
        const data = await res.json();
        if (res.ok) {
            userData = { ...userData, ...data };
            if (userData.balance > 0 || userData.status === 'Ativo') {
                hasDeposited = true;
                localStorage.setItem('hasDeposited', 'true');
            }
            updateUI();
            checkFirstTimePopup();
            startLiveNotifications();
            startOnlineCounter();
            connectWebSocket();
            if (typeof carregarDadosAfiliado === 'function') carregarDadosAfiliado();
        }
    } catch (error) {
        console.error('Erro ao carregar usuário:', error);
        updateUI();
    }
}

function updateUI() {
    const userNameEl = document.getElementById('user-name');
    const userAvatarEl = document.getElementById('user-avatar');
    const userBalanceEl = document.getElementById('user-balance');
    if (userNameEl) userNameEl.textContent = userData.name || 'Usuário';
    if (userAvatarEl) userAvatarEl.textContent = (userData.name || 'U').charAt(0);
    if (userBalanceEl) userBalanceEl.textContent = `R$ ${(userData.balance || 0).toFixed(2)}`;
    if (userData.balance > highestBalance) highestBalance = userData.balance;
    if (hasDeposited) checkBalanceConditions();
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
        if (userData) ws.send(JSON.stringify({ type: 'auth', userId: userData.id }));
    };
    ws.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.type === 'balance_update') {
                userData.balance = data.data.balance;
                updateUI();
            } else if (data.type === 'deposit_confirmed') {
                userData.balance = data.data.newBalance;
                updateUI();
                alert('✅ Depósito confirmado!');
            } else if (data.type === 'withdraw_approved') {
                userData.balance = data.data.newBalance;
                updateUI();
                alert('✅ Saque aprovado!');
            } else if (data.type === 'affiliate_commission') {
                if (typeof carregarDadosAfiliado === 'function') carregarDadosAfiliado();
            }
        } catch (error) {
            console.error('Erro no WebSocket:', error);
        }
    };
    ws.onclose = () => setTimeout(connectWebSocket, 3000);
}

function startLiveNotifications() {
    setInterval(addRandomNotification, 30000 + Math.random() * 30000);
    setTimeout(addRandomNotification, 5000);
}

function addRandomNotification() {
    const types = ['win','withdraw','deposit'];
    const type = types[Math.floor(Math.random()*types.length)];
    const name = fakeNames[Math.floor(Math.random()*fakeNames.length)];
    const amount = (Math.random()*2000+100).toFixed(2);
    const container = document.getElementById('live-notifications');
    if (!container) return;
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.innerHTML = `<div>${type==='win'?'🏆':type==='withdraw'?'💸':'💰'} ${name} ${type==='win'?'ganhou':type==='withdraw'?'sacou':'depositou'} R$ ${amount}</div>`;
    container.appendChild(notif);
    setTimeout(() => notif.remove(), 5000);
}

function startOnlineCounter() {
    setInterval(() => {
        const counter = document.getElementById('online-count');
        if (counter) counter.textContent = 147 + Math.floor(Math.random()*20-10);
    }, 10000);
}

function checkFirstTimePopup() {
    if (showFirstTimePopup && !hasDeposited && userData && userData.status === 'Pendente') {
        setTimeout(() => showDepositPopup('first-time'), 2000);
    }
}

function checkBalanceConditions() {
    if (!hasDeposited || !userData) return;
    if (userData.balance <= 0) {
        showDepositPopup('zero');
    } else if (highestBalance > 0) {
        const percentLost = ((highestBalance - userData.balance) / highestBalance) * 100;
        if (percentLost >= 80 && !localStorage.getItem('lowBalanceShown')) {
            showDepositPopup('low-balance');
            localStorage.setItem('lowBalanceShown', 'true');
            setTimeout(() => localStorage.removeItem('lowBalanceShown'), 300000);
        }
    }
}

function showDepositPopup(type) {
    if (document.querySelector('.deposit-popup')) return;
    const popup = document.createElement('div');
    popup.className = 'deposit-popup';
    popup.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); backdrop-filter:blur(10px); z-index:3000; display:flex; justify-content:center; align-items:center;';
    let content = '';
    if (type === 'zero') {
        content = `<div style="background:linear-gradient(135deg,#1a1f2f,#0b0f1a); border:2px solid var(--primary); border-radius:30px; padding:30px; max-width:400px; text-align:center;"><h3 style="color:var(--primary);">⚠️ SALDO ZERADO</h3><p>Faça um depósito para continuar jogando!</p><button class="btn btn-primary" onclick="showDepositModal();this.closest('.deposit-popup').remove()">DEPOSITAR</button></div>`;
    } else if (type === 'low-balance') {
        content = `<div style="background:linear-gradient(135deg,#1a1f2f,#0b0f1a); border:2px solid var(--primary); border-radius:30px; padding:30px; max-width:400px; text-align:center;"><button style="position:absolute;top:10px;right:10px;background:none;border:none;color:var(--primary);font-size:24px;" onclick="this.closest('.deposit-popup').remove()">×</button><h3 style="color:var(--primary);">⚠️ SALDO BAIXO</h3><p>Seu saldo está acabando. Reforce para não ficar de fora.</p><button class="btn btn-primary" onclick="showDepositModal();this.closest('.deposit-popup').remove()">DEPOSITAR</button></div>`;
        setTimeout(() => { if (popup.parentNode) popup.remove(); }, 5000);
    } else if (type === 'first-time') {
        content = `<div style="background:linear-gradient(135deg,#1a1f2f,#0b0f1a); border:2px solid var(--primary); border-radius:30px; padding:30px; max-width:400px; text-align:center;"><button style="position:absolute;top:10px;right:10px;background:none;border:none;color:var(--primary);font-size:24px;" onclick="this.closest('.deposit-popup').remove()">×</button><h3 style="color:var(--primary);">🎉 BEM-VINDO!</h3><p>Faça seu primeiro depósito e ganhe bônus!</p><button class="btn btn-primary" onclick="showDepositModal();this.closest('.deposit-popup').remove()">DEPOSITAR</button></div>`;
        localStorage.setItem('firstDepositShown', 'true');
    }
    popup.innerHTML = content;
    document.body.appendChild(popup);
}

window.showDepositModal = async function() {
    selectedDepositAmount = null;
    const customContainer = document.getElementById('custom-amount-container');
    if (customContainer) customContainer.style.display = 'none';
    const customInput = document.getElementById('custom-amount');
    if (customInput) customInput.value = '';
    const modal = document.getElementById('qr-modal');
    if (modal) modal.style.display = 'block';
    try {
        const res = await fetch('/api/pix-qrcode');
        const data = await res.json();
        if (res.ok) {
            const img = document.getElementById('qr-code-img');
            const key = document.getElementById('pix-key-display');
            if (img) img.src = data.qrcode;
            if (key) key.textContent = data.pixKey;
        } else alert('Erro ao carregar QR Code');
    } catch(e) { alert('Erro de conexão'); }
};

function setDepositAmount(amount) {
    selectedDepositAmount = amount;
    const customContainer = document.getElementById('custom-amount-container');
    if (customContainer) customContainer.style.display = 'none';
    alert(`Valor de R$ ${amount} selecionado! Copie a chave PIX e faça o pagamento.`);
}

function setCustomAmount() {
    const customContainer = document.getElementById('custom-amount-container');
    if (customContainer) customContainer.style.display = 'block';
    selectedDepositAmount = null;
}

async function confirmDepositRequest() {
    if (!userData) { alert('Usuário não logado'); return; }
    let amount = selectedDepositAmount;
    if (!amount) {
        amount = parseFloat(document.getElementById('custom-amount')?.value);
        if (!amount || amount < 20) {
            alert('❌ Digite um valor válido (mínimo R$ 20)');
            return;
        }
    }
    try {
        const response = await fetch('/api/request-deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData.id, amount })
        });
        const data = await response.json();
        if (response.ok) {
            alert('✅ ' + data.message);
            closeModal();
        } else {
            alert('❌ ' + (data.error || 'Erro ao solicitar depósito'));
        }
    } catch (error) {
        alert('❌ Erro de conexão');
    }
}

function closeModal() {
    const modal = document.getElementById('qr-modal');
    if (modal) modal.style.display = 'none';
}

function copyPixKey() {
    const key = document.getElementById('pix-key-display');
    if (key) {
        navigator.clipboard.writeText(key.textContent);
        alert('Chave copiada!');
    }
}

function logout() {
    localStorage.removeItem('user');
    window.location.href = '/login';
}