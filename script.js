document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURAÇÃO ---
    // IMPORTANTE: Substitua 'SUA_CHAVE_PIX_AQUI' pela sua chave PIX real da conta Revolut.
    const ADMIN_PIX_KEY = 'SUA_CHAVE_PIX_AQUI';
    const MIN_DEPOSIT = 50;
    const BONUS_AMOUNT = 30;
    const MIN_WITHDRAW = 150;

    // --- VARIÁVEIS GLOBAIS ---
    let userData = {
        name: '',
        pix: '',
        balance: 0,
        depositConfirmed: false
    };

    // --- ELEMENTOS DO DOM ---
    const steps = {
        register: document.getElementById('step-register'),
        deposit: document.getElementById('step-deposit'),
        game: document.getElementById('step-game')
    };
    const registerForm = document.getElementById('register-form');
    const pixKeyDisplay = document.getElementById('pix-key-display');
    const qrcodeContainer = document.getElementById('qrcode');
    const btnConfirmDeposit = document.getElementById('btn-confirm-deposit');
    const displayName = document.getElementById('display-name');
    const balanceDisplay = document.getElementById('balance');
    const betAmountInput = document.getElementById('bet-amount');
    const btnUp = document.getElementById('btn-up');
    const btnDown = document.getElementById('btn-down');
    const gameResult = document.getElementById('game-result');
    const btnWithdraw = document.getElementById('btn-withdraw');

    // --- FUNÇÕ