// ==================== VARIÁVEIS GLOBAIS ====================
let adminData = null;
let ws = null;
let currentSection = 'dashboard';
let refreshInterval = null;

// ==================== INICIALIZAÇÃO ====================
document.addEventListener('DOMContentLoaded', function() {
    // Carrega dados do admin
    const adminStr = localStorage.getItem('adminUser');
    if (!adminStr) {
        window.location.href = '/admin/login.html';
        return;
    }
    
    try {
        adminData = JSON.parse(adminStr);
        document.getElementById('admin-name').textContent = adminData.name || 'Admin';
        document.getElementById('admin-avatar').textContent = (adminData.name || 'A').charAt(0).toUpperCase();
    } catch (e) {
        window.location.href = '/admin/login.html';
        return;
    }
    
    // Inicia WebSocket
    connectWebSocket();
    
    // Carrega dados iniciais
    loadDashboard();
    
    // Atualiza relógio
    updateDateTime();
    setInterval(updateDateTime, 1000);
    
    // Auto-refresh a cada 30 segundos
    refreshInterval = setInterval(refreshData, 30000);
});

// ==================== WEBSOCKET ====================
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('✅ WebSocket conectado');
        if (adminData) {
            ws.send(JSON.stringify({ 
                type: 'admin_auth', 
                adminId: adminData.id 
            }));
        }
    };
    
    ws.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('Erro no WebSocket:', error);
        }
    };
    
    ws.onclose = () => {
        console.log('⚠️ WebSocket desconectado, reconectando...');
        setTimeout(connectWebSocket, 3000);
    };
}

function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'new_deposit':
            updateBadges();
            if (currentSection === 'deposits') loadDeposits();
            addLog('💰 Novo depósito solicitado: R$ ' + data.amount, 'info');
            break;
            
        case 'new_withdraw':
            updateBadges();
            if (currentSection === 'withdraws') loadWithdraws();
            addLog('💸 Novo saque solicitado: R$ ' + data.amount, 'info');
            break;
            
        case 'new_user':
            updateBadges();
            if (currentSection === 'users') loadUsers();
            addLog('👤 Novo usuário cadastrado: ' + data.name, 'success');
            break;
            
        case 'balance_update':
            if (currentSection === 'dashboard') loadDashboard();
            if (currentSection === 'users') loadUsers();
            break;
            
        case 'server_status':
            updateServerStatus(data.status);
            break;
    }
}

// ==================== FUNÇÕES GERAIS ====================
function updateDateTime() {
    const now = new Date();
    const datetime = document.getElementById('datetime');
    if (datetime) {
        datetime.innerHTML = now.toLocaleString('pt-BR', {
            dateStyle: 'full',
            timeStyle: 'medium'
        });
    }
}

function updateServerStatus(status) {
    const statusEl = document.getElementById('server-status');
    if (statusEl) {
        if (status === 'online') {
            statusEl.innerHTML = '<i class="fas fa-circle"></i><span>Servidor Online</span>';
            statusEl.className = 'server-status';
        } else {
            statusEl.innerHTML = '<i class="fas fa-circle"></i><span>Servidor Offline</span>';
            statusEl.className = 'server-status offline';
        }
    }
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('collapsed');
}

function showSection(section, element) {
    currentSection = section;
    
    // Atualiza título
    const titles = {
        'dashboard': 'Dashboard',
        'users': 'Usuários',
        'deposits': 'Depósitos',
        'withdraws': 'Saques',
        'games': 'Jogos',
        'config': 'Configurações',
        'logs': 'Logs do Sistema'
    };
    document.getElementById('page-title').textContent = titles[section] || 'Dashboard';
    
    // Atualiza navegação
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    if (element) element.classList.add('active');
    
    // Mostra seção
    document.querySelectorAll('.content-section').forEach(s => {
        s.classList.remove('active');
    });
    document.getElementById(section + '-section').classList.add('active');
    
    // Carrega dados
    switch(section) {
        case 'dashboard': loadDashboard(); break;
        case 'users': loadUsers(); break;
        case 'deposits': loadDeposits(); break;
        case 'withdraws': loadWithdraws(); break;
        case 'games': loadGameHistory(); break;
        case 'config': loadConfig(); break;
        case 'logs': loadLogs(); break;
    }
}

function refreshData() {
    switch(currentSection) {
        case 'dashboard': loadDashboard(); break;
        case 'users': loadUsers(); break;
        case 'deposits': loadDeposits(); break;
        case 'withdraws': loadWithdraws(); break;
        case 'games': loadGameHistory(); break;
    }
    updateBadges();
}

function getAuthHeader() {
    return 'Basic ' + btoa(`${adminData.email}:admin123`);
}

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { 
        style: 'currency', 
        currency: 'BRL' 
    }).format(value || 0);
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleString('pt-BR');
}

function addLog(message, type = 'info') {
    const container = document.getElementById('logs-container');
    if (!container) return;
    
    const now = new Date().toLocaleTimeString('pt-BR');
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.innerHTML = `[${now}] ${message}`;
    
    container.insertBefore(logEntry, container.firstChild);
    
    // Limita a 100 logs
    while (container.children.length > 100) {
        container.removeChild(container.lastChild);
    }
}

// ==================== DASHBOARD ====================
async function loadDashboard() {
    try {
        const res = await fetch('/api/admin/stats', { 
            headers: { 'Authorization': getAuthHeader() } 
        });
        const data = await res.json();
        
        if (res.ok) {
            document.getElementById('stat-total-users').textContent = data.total_users || 0;
            document.getElementById('stat-users-online').textContent = `${data.users_online || 0} online`;
            document.getElementById('stat-total-balance').textContent = formatCurrency(data.total_balance);
            document.getElementById('stat-pending-deposits').textContent = data.pending_deposits || 0;
            document.getElementById('stat-pending-deposits-amount').textContent = formatCurrency(data.pending_deposits_amount);
            document.getElementById('stat-pending-withdraws').textContent = data.pending_withdraws || 0;
            document.getElementById('stat-pending-withdraws-amount').textContent = formatCurrency(data.pending_withdraws_amount);
            document.getElementById('stat-total-bets').textContent = formatCurrency(data.total_bets);
            document.getElementById('stat-total-wins').textContent = formatCurrency(data.total_wins);
        }
    } catch (error) {
        console.error('Erro ao carregar dashboard:', error);
    }
    
    loadRecentDeposits();
    loadRecentWithdraws();
    loadRecentGames();
    loadOnlineUsers();
}

async function loadRecentDeposits() {
    try {
        const res = await fetch('/api/admin/deposits?limit=5', { 
            headers: { 'Authorization': getAuthHeader() } 
        });
        const deposits = await res.json();
        
        const container = document.getElementById('recent-deposits');
        if (deposits.length === 0) {
            container.innerHTML = '<div class="loading">Nenhum depósito recente</div>';
            return;
        }
        
        container.innerHTML = deposits.map(d => `
            <div class="recent-item">
                <div><strong>${d.name}</strong></div>
                <div>${formatCurrency(d.amount)}</div>
                <div class="text-small">${formatDate(d.created_at)}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Erro ao carregar depósitos recentes:', error);
    }
}

async function loadRecentWithdraws() {
    try {
        const res = await fetch('/api/admin/withdraws?limit=5', { 
            headers: { 'Authorization': getAuthHeader() } 
        });
        const withdraws = await res.json();
        
        const container = document.getElementById('recent-withdraws');
        if (withdraws.length === 0) {
            container.innerHTML = '<div class="loading">Nenhum saque recente</div>';
            return;
        }
        
        container.innerHTML = withdraws.map(w => `
            <div class="recent-item">
                <div><strong>${w.name}</strong></div>
                <div>${formatCurrency(w.amount)}</div>
                <div class="text-small">${formatDate(w.created_at)}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Erro ao carregar saques recentes:', error);
    }
}

async function loadRecentGames() {
    try {
        const res = await fetch('/api/admin/game-history?limit=5', { 
            headers: { 'Authorization': getAuthHeader() } 
        });
        const games = await res.json();
        
        const container = document.getElementById('recent-games');
        if (games.length === 0) {
            container.innerHTML = '<div class="loading">Nenhum jogo recente</div>';
            return;
        }
        
        container.innerHTML = games.map(g => `
            <div class="recent-item">
                <div><strong>${g.name}</strong> - ${g.game}</div>
                <div>Aposta: ${formatCurrency(g.bet_amount)} | Ganho: ${formatCurrency(g.win_amount)}</div>
                <div class="text-small">${formatDate(g.created_at)}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Erro ao carregar jogos recentes:', error);
    }
}

async function loadOnlineUsers() {
    try {
        const res = await fetch('/api/admin/online-users', { 
            headers: { 'Authorization': getAuthHeader() } 
        });
        const users = await res.json();
        
        document.getElementById('online-count').textContent = users.length;
        
        const container = document.getElementById('online-users');
        if (users.length === 0) {
            container.innerHTML = '<div class="loading">Nenhum usuário online</div>';
            return;
        }
        
        container.innerHTML = users.map(u => `
            <div class="recent-item">
                <div><strong>${u.name}</strong></div>
                <div>${u.email}</div>
                <div>Saldo: ${formatCurrency(u.balance + u.bonus_balance)}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Erro ao carregar usuários online:', error);
    }
}

// ==================== USUÁRIOS ====================
async function loadUsers() {
    const tbody = document.getElementById('users-list');
    tbody.innerHTML = '<tr><td colspan="11" class="loading"><i class="fas fa-spinner fa-spin"></i><br>Carregando...</td></tr>';
    
    const search = document.getElementById('user-search')?.value || '';
    const status = document.getElementById('user-status-filter')?.value || 'todos';
    
    try {
        const res = await fetch(`/api/admin/users?search=${encodeURIComponent(search)}&status=${status}`, {
            headers: { 'Authorization': getAuthHeader() }
        });
        const users = await res.json();
        
        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;">Nenhum usuário encontrado</td></tr>';
            return;
        }
        
        tbody.innerHTML = users.map(u => `
            <tr>
                <td>#${u.id}</td>
                <td>${u.name || '-'}</td>
                <td>${u.email}</td>
                <td>${u.pix_key || '-'}</td>
                <td>${formatCurrency(u.balance)}</td>
                <td>${formatCurrency(u.bonus_balance)}</td>
                <td><strong>${formatCurrency((u.balance || 0) + (u.bonus_balance || 0))}</strong></td>
                <td>${formatCurrency(u.rollover_remaining)}</td>
                <td>${u.meta_progress || 0}/${u.meta_atual === 1 ? 'Meta Inicial' : 'Meta Final'}</td>
                <td><span class="status-badge status-${u.status.replace(' ', '-')}">${u.status}</span></td>
                <td>
                    <div class="btn-group">
                        <button class="btn-sm btn-warning" onclick="editUser(${u.id})" title="Editar">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-sm btn-success" onclick="adjustBalance(${u.id})" title="Ajustar Saldo">
                            <i class="fas fa-coins"></i>
                        </button>
                        <button class="btn-sm btn-danger" onclick="blockUser(${u.id})" title="Bloquear">
                            <i class="fas fa-ban"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="11" style="color:var(--danger);">Erro ao carregar usuários</td></tr>';
    }
}

async function editUser(id) {
    try {
        const res = await fetch(`/api/admin/user/${id}`, { 
            headers: { 'Authorization': getAuthHeader() } 
        });
        const user = await res.json();
        
        const form = document.getElementById('user-form');
        form.innerHTML = `
            <div class="config-item">
                <label>Nome</label>
                <input type="text" id="edit-name" value="${user.name || ''}">
            </div>
            <div class="config-item">
                <label>Email</label>
                <input type="email" id="edit-email" value="${user.email || ''}">
            </div>
            <div class="config-item">
                <label>CPF</label>
                <input type="text" id="edit-cpf" value="${user.cpf || ''}">
            </div>
            <div class="config-item">
                <label>Telefone</label>
                <input type="text" id="edit-phone" value="${user.phone || ''}">
            </div>
            <div class="config-item">
                <label>Chave PIX</label>
                <input type="text" id="edit-pix" value="${user.pix_key || ''}">
            </div>
            <div class="config-item">
                <label>Saldo Real (R$)</label>
                <input type="number" id="edit-balance" step="0.01" value="${user.balance || 0}">
            </div>
            <div class="config-item">
                <label>Saldo Bônus (R$)</label>
                <input type="number" id="edit-bonus-balance" step="0.01" value="${user.bonus_balance || 0}">
            </div>
            <div class="config-item">
                <label>Rollover Restante (R$)</label>
                <input type="number" id="edit-rollover" step="0.01" value="${user.rollover_remaining || 0}">
            </div>
            <div class="config-item">
                <label>Status</label>
                <select id="edit-status">
                    <option value="Pendente" ${user.status === 'Pendente' ? 'selected' : ''}>Pendente</option>
                    <option value="Ativo" ${user.status === 'Ativo' ? 'selected' : ''}>Ativo</option>
                    <option value="Aguardando Depósito" ${user.status === 'Aguardando Depósito' ? 'selected' : ''}>Aguardando Depósito</option>
                    <option value="Pode Sacar" ${user.status === 'Pode Sacar' ? 'selected' : ''}>Pode Sacar</option>
                    <option value="Bloqueado" ${user.status === 'Bloqueado' ? 'selected' : ''}>Bloqueado</option>
                </select>
            </div>
            <div class="config-item">
                <label>Meta Atual</label>
                <select id="edit-meta">
                    <option value="1" ${user.meta_atual === 1 ? 'selected' : ''}>Meta Inicial</option>
                    <option value="2" ${user.meta_atual === 2 ? 'selected' : ''}>Meta Pós-Depósito</option>
                </select>
            </div>
            <div class="config-item">
                <label>Progresso da Meta (R$)</label>
                <input type="number" id="edit-meta-progress" step="0.01" value="${user.meta_progress || 0}">
            </div>
            <button class="btn-save" onclick="updateUser(${user.id})" style="width:100%;">
                <i class="fas fa-save"></i> SALVAR ALTERAÇÕES
            </button>
        `;
        
        openModal('user-modal');
    } catch (error) {
        alert('Erro ao carregar usuário: ' + error.message);
    }
}

async function updateUser(id) {
    const data = {
        name: document.getElementById('edit-name').value,
        email: document.getElementById('edit-email').value,
        cpf: document.getElementById('edit-cpf').value,
        phone: document.getElementById('edit-phone').value,
        pix_key: document.getElementById('edit-pix').value,
        balance: parseFloat(document.getElementById('edit-balance').value),
        bonus_balance: parseFloat(document.getElementById('edit-bonus-balance').value),
        rollover_remaining: parseFloat(document.getElementById('edit-rollover').value),
        status: document.getElementById('edit-status').value,
        meta_atual: parseInt(document.getElementById('edit-meta').value),
        meta_progress: parseFloat(document.getElementById('edit-meta-progress').value)
    };
    
    try {
        const res = await fetch(`/api/admin/user/${id}/update`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': getAuthHeader() 
            },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        
        if (res.ok) {
            alert('✅ Usuário atualizado com sucesso!');
            closeModal('user-modal');
            loadUsers();
            addLog(`Usuário ${data.name} atualizado`, 'success');
        } else {
            alert('❌ Erro: ' + result.error);
        }
    } catch (error) {
        alert('Erro ao atualizar: ' + error.message);
    }
}

async function adjustBalance(id) {
    const amount = prompt('Digite o valor para ajustar (pode ser positivo ou negativo):');
    if (!amount) return;
    
    try {
        const res = await fetch(`/api/admin/user/${id}/adjust-balance`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': getAuthHeader() 
            },
            body: JSON.stringify({ amount: parseFloat(amount) })
        });
        const result = await res.json();
        
        if (res.ok) {
            alert('✅ Saldo ajustado!');
            loadUsers();
        } else {
            alert('❌ Erro: ' + result.error);
        }
    } catch (error) {
        alert('Erro: ' + error.message);
    }
}

async function blockUser(id) {
    if (!confirm('Tem certeza que deseja bloquear este usuário?')) return;
    
    try {
        const res = await fetch(`/api/admin/user/${id}/block`, {
            method: 'POST',
            headers: { 'Authorization': getAuthHeader() }
        });
        const result = await res.json();
        
        if (res.ok) {
            alert('✅ Usuário bloqueado!');
            loadUsers();
        } else {
            alert('❌ Erro: ' + result.error);
        }
    } catch (error) {
        alert('Erro: ' + error.message);
    }
}

// ==================== DEPÓSITOS ====================
async function loadDeposits() {
    const tbody = document.getElementById('deposits-list');
    tbody.innerHTML = '<tr><td colspan="6" class="loading"><i class="fas fa-spinner fa-spin"></i><br>Carregando...</td></tr>';
    
    try {
        const res = await fetch('/api/admin/deposits', { 
            headers: { 'Authorization': getAuthHeader() } 
        });
        const deposits = await res.json();
        
        if (deposits.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhum depósito pendente</td></tr>';
            return;
        }
        
        tbody.innerHTML = deposits.map(d => `
            <tr>
                <td>#${d.id}</td>
                <td>${d.name}</td>
                <td>${d.email}</td>
                <td><strong>${formatCurrency(d.amount)}</strong></td>
                <td>${formatDate(d.created_at)}</td>
                <td>
                    <div class="btn-group">
                        <button class="btn-sm btn-success" onclick="showConfirmDeposit(${d.id}, ${d.amount})">
                            <i class="fas fa-check"></i> Confirmar
                        </button>
                        <button class="btn-sm btn-danger" onclick="rejectDeposit(${d.id})">
                            <i class="fas fa-times"></i> Rejeitar
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:var(--danger);">Erro ao carregar depósitos</td></tr>';
    }
}

function showConfirmDeposit(id, amount) {
    const form = document.getElementById('deposit-form');
    form.innerHTML = `
        <div class="config-item">
            <label>Valor do Depósito (R$)</label>
            <input type="number" id="deposit-amount" step="0.01" value="${amount}" readonly>
        </div>
        <div class="config-item">
            <label>Bônus a Adicionar (R$)</label>
            <input type="number" id="deposit-bonus" step="0.01" value="${document.getElementById('config-bonus-amount')?.value || 30}">
        </div>
        <p style="color:var(--gray); margin:10px 0;">Total a creditar: R$ <span id="deposit-total">${(amount + (parseFloat(document.getElementById('config-bonus-amount')?.value || 30))).toFixed(2)}</span></p>
        <button class="btn-save" onclick="confirmDeposit(${id})" style="width:100%;">
            <i class="fas fa-check"></i> CONFIRMAR DEPÓSITO
        </button>
    `;
    
    document.getElementById('deposit-amount').addEventListener('input', updateDepositTotal);
    document.getElementById('deposit-bonus').addEventListener('input', updateDepositTotal);
    
    openModal('deposit-modal');
}

function updateDepositTotal() {
    const amount = parseFloat(document.getElementById('deposit-amount')?.value || 0);
    const bonus = parseFloat(document.getElementById('deposit-bonus')?.value || 0);
    document.getElementById('deposit-total').textContent = (amount + bonus).toFixed(2);
}

async function confirmDeposit(id) {
    const amount = parseFloat(document.getElementById('deposit-amount').value);
    const bonus = parseFloat(document.getElementById('deposit-bonus').value);
    
    try {
        const res = await fetch(`/api/admin/confirm-deposit/${id}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': getAuthHeader() 
            },
            body: JSON.stringify({ amount, bonus })
        });
        const result = await res.json();
        
        if (res.ok) {
            alert('✅ ' + result.message);
            closeModal('deposit-modal');
            loadDeposits();
            loadDashboard();
            addLog(`Depósito #${id} confirmado: R$ ${amount} + bônus R$ ${bonus}`, 'success');
        } else {
            alert('❌ Erro: ' + result.error);
        }
    } catch (error) {
        alert('Erro ao confirmar: ' + error.message);
    }
}

async function rejectDeposit(id) {
    if (!confirm('Rejeitar este depósito?')) return;
    
    try {
        const res = await fetch(`/api/admin/reject-deposit/${id}`, {
            method: 'POST',
            headers: { 'Authorization': getAuthHeader() }
        });
        const result = await res.json();
        
        alert(result.message || 'Depósito rejeitado');
        loadDeposits();
        addLog(`Depósito #${id} rejeitado`, 'warning');
    } catch (error) {
        alert('Erro: ' + error.message);
    }
}

// ==================== SAQUES ====================
async function loadWithdraws() {
    const tbody = document.getElementById('withdraws-list');
    tbody.innerHTML = '<tr><td colspan="8" class="loading"><i class="fas fa-spinner fa-spin"></i><br>Carregando...</td></tr>';
    
    try {
        const res = await fetch('/api/admin/withdraws', { 
            headers: { 'Authorization': getAuthHeader() } 
        });
        const withdraws = await res.json();
        
        if (withdraws.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Nenhum saque pendente</td></tr>';
            return;
        }
        
        tbody.innerHTML = withdraws.map(w => `
            <tr>
                <td>#${w.id}</td>
                <td>${w.name}</td>
                <td>${w.email}</td>
                <td><strong>${formatCurrency(w.amount)}</strong></td>
                <td>${w.cpf || '-'}</td>
                <td>${w.pix_key || '-'}</td>
                <td>${formatDate(w.created_at)}</td>
                <td>
                    <div class="btn-group">
                        <button class="btn-sm btn-success" onclick="approveWithdraw(${w.id})">
                            <i class="fas fa-check"></i> Aprovar
                        </button>
                        <button class="btn-sm btn-danger" onclick="rejectWithdraw(${w.id})">
                            <i class="fas fa-times"></i> Rejeitar
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="8" style="color:var(--danger);">Erro ao carregar saques</td></tr>';
    }
}

async function approveWithdraw(id) {
    if (!confirm('Aprovar este saque?')) return;
    
    try {
        const res = await fetch(`/api/admin/withdraw/${id}/approve`, {
            method: 'POST',
            headers: { 'Authorization': getAuthHeader() }
        });
        const result = await res.json();
        
        alert(result.message || 'Saque aprovado');
        loadWithdraws();
        loadDashboard();
        addLog(`Saque #${id} aprovado`, 'success');
    } catch (error) {
        alert('Erro: ' + error.message);
    }
}

async function rejectWithdraw(id) {
    const reason = prompt('Motivo da rejeição (opcional):');
    
    try {
        const res = await fetch(`/api/admin/withdraw/${id}/reject`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': getAuthHeader() 
            },
            body: JSON.stringify({ reason })
        });
        const result = await res.json();
        
        alert(result.message || 'Saque rejeitado');
        loadWithdraws();
        addLog(`Saque #${id} rejeitado: ${reason || 'sem motivo'}`, 'warning');
    } catch (error) {
        alert('Erro: ' + error.message);
    }
}

// ==================== JOGOS ====================
async function loadGameHistory() {
    const tbody = document.getElementById('games-list');
    tbody.innerHTML = '<tr><td colspan="7" class="loading"><i class="fas fa-spinner fa-spin"></i><br>Carregando...</td></tr>';
    
    const search = document.getElementById('game-search')?.value || '';
    const filter = document.getElementById('game-filter')?.value || 'todos';
    
    try {
        const res = await fetch(`/api/admin/game-history?search=${encodeURIComponent(search)}&game=${filter}`, {
            headers: { 'Authorization': getAuthHeader() }
        });
        const games = await res.json();
        
        if (games.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Nenhum histórico encontrado</td></tr>';
            return;
        }
        
        tbody.innerHTML = games.map(g => `
            <tr>
                <td>#${g.id}</td>
                <td>${g.name}</td>
                <td>${g.game}</td>
                <td>${formatCurrency(g.bet_amount)}</td>
                <td>${formatCurrency(g.win_amount)}</td>
                <td><span class="status-badge status-${g.result}">${g.result === 'win' ? 'Vitória' : 'Derrota'}</span></td>
                <td>${formatDate(g.created_at)}</td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:var(--danger);">Erro ao carregar histórico</td></tr>';
    }
}

// ==================== CONFIGURAÇÕES ====================
async function loadConfig() {
    try {
        const res = await fetch('/api/admin/config', { 
            headers: { 'Authorization': getAuthHeader() } 
        });
        const config = await res.json();
        
        // Gerais
        document.getElementById('config-pix-key').value = config.pix_key || '';
        document.getElementById('config-maintenance').value = config.maintenance_mode || 0;
        document.getElementById('config-allow-deposits').value = config.allow_deposits || 1;
        document.getElementById('config-allow-withdrawals').value = config.allow_withdrawals || 1;
        
        // Depósitos/Saques
        document.getElementById('config-min-deposit').value = config.min_deposit || 20;
        document.getElementById('config-bonus-amount').value = config.bonus_amount || 30;
        document.getElementById('config-min-withdraw').value = config.min_withdraw || 150;
        document.getElementById('config-max-withdraw').value = config.max_withdraw || 5000;
        document.getElementById('config-withdraw-fee').value = config.withdraw_fee || 0;
        
        // Metas
        document.getElementById('config-initial-bonus').value = config.initial_bonus || 20;
        document.getElementById('config-initial-goal').value = config.initial_goal || 100;
        document.getElementById('config-required-deposit').value = config.required_deposit || 50;
        document.getElementById('config-post-deposit-goal').value = config.post_deposit_goal || 500;
        document.getElementById('config-rollover-multiplier').value = config.rollover_multiplier || 10;
        document.getElementById('config-enable-rollover').value = config.enable_rollover || 1;
        
        // RTP
        document.getElementById('config-fortune-ox-rtp').value = config.fortune_ox_rtp || 96.75;
        document.getElementById('config-slot-rtp').value = config.slot_rtp || 95;
        document.getElementById('config-dice-rtp').value = config.dice_rtp || 95;
        document.getElementById('config-crash-rtp').value = config.crash_rtp || 95;
        document.getElementById('config-roulette-rtp').value = config.roulette_rtp || 95;
        document.getElementById('config-blackjack-rtp').value = config.blackjack_rtp || 95;
        
        // Limites
        document.getElementById('config-fortune-ox-min-bet').value = config.fortune_ox_min_bet || 5;
        document.getElementById('config-slot-min-bet').value = config.slot_min_bet || 5;
        document.getElementById('config-dice-min-bet').value = config.dice_min_bet || 5;
        document.getElementById('config-crash-min-bet').value = config.crash_min_bet || 5;
        document.getElementById('config-roulette-min-bet').value = config.roulette_min_bet || 5;
        document.getElementById('config-blackjack-min-bet').value = config.blackjack_min_bet || 5;
        
    } catch (error) {
        showMessage('config-message', 'Erro ao carregar configurações', 'error');
    }
}

function showConfigTab(tab) {
    document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.config-panel').forEach(p => p.classList.remove('active'));
    
    document.querySelector(`.config-tab[onclick="showConfigTab('${tab}')"]`).classList.add('active');
    document.getElementById(`config-${tab}`).classList.add('active');
}

async function saveAllConfigs() {
    const config = {
        pix_key: document.getElementById('config-pix-key').value,
        maintenance_mode: parseInt(document.getElementById('config-maintenance').value),
        allow_deposits: parseInt(document.getElementById('config-allow-deposits').value),
        allow_withdrawals: parseInt(document.getElementById('config-allow-withdrawals').value),
        
        min_deposit: parseFloat(document.getElementById('config-min-deposit').value),
        bonus_amount: parseFloat(document.getElementById('config-bonus-amount').value),
        min_withdraw: parseFloat(document.getElementById('config-min-withdraw').value),
        max_withdraw: parseFloat(document.getElementById('config-max-withdraw').value),
        withdraw_fee: parseFloat(document.getElementById('config-withdraw-fee').value),
        
        initial_bonus: parseFloat(document.getElementById('config-initial-bonus').value),
        initial_goal: parseFloat(document.getElementById('config-initial-goal').value),
        required_deposit: parseFloat(document.getElementById('config-required-deposit').value),
        post_deposit_goal: parseFloat(document.getElementById('config-post-deposit-goal').value),
        rollover_multiplier: parseFloat(document.getElementById('config-rollover-multiplier').value),
        enable_rollover: parseInt(document.getElementById('config-enable-rollover').value),
        
        fortune_ox_rtp: parseFloat(document.getElementById('config-fortune-ox-rtp').value),
        slot_rtp: parseFloat(document.getElementById('config-slot-rtp').value),
        dice_rtp: parseFloat(document.getElementById('config-dice-rtp').value),
        crash_rtp: parseFloat(document.getElementById('config-crash-rtp').value),
        roulette_rtp: parseFloat(document.getElementById('config-roulette-rtp').value),
        blackjack_rtp: parseFloat(document.getElementById('config-blackjack-rtp').value),
        
        fortune_ox_min_bet: parseFloat(document.getElementById('config-fortune-ox-min-bet').value),
        slot_min_bet: parseFloat(document.getElementById('config-slot-min-bet').value),
        dice_min_bet: parseFloat(document.getElementById('config-dice-min-bet').value),
        crash_min_bet: parseFloat(document.getElementById('config-crash-min-bet').value),
        roulette_min_bet: parseFloat(document.getElementById('config-roulette-min-bet').value),
        blackjack_min_bet: parseFloat(document.getElementById('config-blackjack-min-bet').value)
    };
    
    try {
        const res = await fetch('/api/admin/config', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': getAuthHeader() 
            },
            body: JSON.stringify(config)
        });
        const result = await res.json();
        
        if (res.ok) {
            showMessage('config-message', '✅ Configurações salvas com sucesso!', 'success');
            addLog('Configurações do sistema atualizadas', 'success');
        } else {
            showMessage('config-message', '❌ ' + result.error, 'error');
        }
    } catch (error) {
        showMessage('config-message', '❌ Erro ao salvar: ' + error.message, 'error');
    }
}

// ==================== LOGS ====================
async function loadLogs() {
    try {
        const res = await fetch('/api/admin/logs', { 
            headers: { 'Authorization': getAuthHeader() } 
        });
        const logs = await res.json();
        
        const container = document.getElementById('logs-container');
        container.innerHTML = logs.map(log => `
            <div class="log-entry ${log.type}">
                [${new Date(log.timestamp).toLocaleString('pt-BR')}] ${log.message}
            </div>
        `).join('');
    } catch (error) {
        console.error('Erro ao carregar logs:', error);
    }
}

async function clearLogs() {
    if (!confirm('Limpar todos os logs?')) return;
    
    try {
        const res = await fetch('/api/admin/clear-logs', {
            method: 'POST',
            headers: { 'Authorization': getAuthHeader() }
        });
        
        if (res.ok) {
            document.getElementById('logs-container').innerHTML = '<div class="log-entry">Logs limpos</div>';
            addLog('Logs do sistema limpos', 'warning');
        }
    } catch (error) {
        alert('Erro ao limpar logs: ' + error.message);
    }
}

// ==================== UTILITÁRIOS ====================
async function updateBadges() {
    try {
        const res = await fetch('/api/admin/stats', { 
            headers: { 'Authorization': getAuthHeader() } 
        });
        const data = await res.json();
        
        document.getElementById('users-badge').textContent = data.total_users || 0;
        document.getElementById('deposits-badge').textContent = data.pending_deposits || 0;
        document.getElementById('withdraws-badge').textContent = data.pending_withdraws || 0;
    } catch (error) {
        console.error('Erro ao atualizar badges:', error);
    }
}

function openModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function showMessage(containerId, message, type = 'success') {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = `<div class="message ${type}">${message}</div>`;
        setTimeout(() => container.innerHTML = '', 5000);
    }
}

// ==================== LOGOUT ====================
function logout() {
    if (refreshInterval) clearInterval(refreshInterval);
    if (ws) ws.close();
    localStorage.removeItem('adminUser');
    window.location.href = '/admin/login.html';
}
