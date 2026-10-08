import { supabase } from './supabase.js';

const form = document.getElementById('auth-form');
const emailInput = document.getElementById('auth-email');
const passwordInput = document.getElementById('auth-password');
const submitBtn = document.getElementById('auth-submit');
const toggleModeBtn = document.getElementById('toggle-auth-mode');
const forgotBtn = document.getElementById('btn-forgot');
const subtitle = document.getElementById('login-subtitle');
const feedback = document.getElementById('auth-feedback');
const togglePasswordBtn = document.getElementById('toggle-password');

let mode = 'login';

// Quem já está logado não precisa ver o login de novo.
supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) window.location.replace('dashboard.html');
});

function showFeedback(message, kind = 'error') {
    feedback.textContent = message;
    feedback.className = `auth-feedback is-visible ${kind}`;
}

function clearFeedback() {
    feedback.textContent = '';
    feedback.className = 'auth-feedback';
}

function setBusy(busy, label) {
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? 'Aguarde...' : label;
}

togglePasswordBtn?.addEventListener('click', () => {
    const isHidden = passwordInput.type === 'password';
    passwordInput.type = isHidden ? 'text' : 'password';
    togglePasswordBtn.textContent = isHidden ? 'Ocultar' : 'Ver';
    togglePasswordBtn.setAttribute('aria-label', isHidden ? 'Ocultar senha' : 'Mostrar senha');
});

toggleModeBtn?.addEventListener('click', () => {
    mode = mode === 'login' ? 'signup' : 'login';
    clearFeedback();

    if (mode === 'signup') {
        subtitle.textContent = 'Use o mesmo e-mail em que você foi convidado(a)';
        submitBtn.textContent = 'Criar conta';
        toggleModeBtn.textContent = 'Já tenho conta';
        passwordInput.autocomplete = 'new-password';
    } else {
        subtitle.textContent = 'Entre para ver os valores e o planejamento';
        submitBtn.textContent = 'Entrar';
        toggleModeBtn.textContent = 'Criar uma conta';
        passwordInput.autocomplete = 'current-password';
    }
});

forgotBtn?.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email) {
        showFeedback('Digite seu e-mail acima para receber o link de redefinição.');
        emailInput.focus();
        return;
    }

    forgotBtn.disabled = true;
    const redirectTo = new URL('index.html', window.location.href).href;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    forgotBtn.disabled = false;

    if (error) showFeedback(traduzErro(error));
    else showFeedback('Enviamos um link de redefinição para o seu e-mail.', 'success');
});

form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFeedback();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || password.length < 6) {
        showFeedback('Informe o e-mail e uma senha de pelo menos 6 caracteres.');
        return;
    }

    const label = mode === 'login' ? 'Entrar' : 'Criar conta';
    setBusy(true, label);

    if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        setBusy(false, label);
        if (error) showFeedback(traduzErro(error));
        else window.location.href = 'dashboard.html';
        return;
    }

    // O link de confirmação volta para este mesmo site (precisa estar na lista
    // de Redirect URLs do Supabase em Authentication → URL Configuration).
    const emailRedirectTo = new URL('index.html', window.location.href).href;
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo } });
    setBusy(false, label);

    if (error) {
        showFeedback(traduzErro(error));
        return;
    }

    // Com confirmação de e-mail ligada, o signUp não devolve sessão.
    if (data.session) {
        window.location.href = 'dashboard.html';
    } else {
        showFeedback('Conta criada. Abra o link que enviamos para o seu e-mail e depois entre por aqui.', 'success');
    }
});

function traduzErro(error) {
    const raw = (error?.message || '').toLowerCase();

    if (raw.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
    if (raw.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
    if (raw.includes('user already registered')) return 'Esse e-mail já tem conta. Tente entrar.';
    if (raw.includes('password should be')) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (raw.includes('rate limit') || raw.includes('too many')) return 'Muitas tentativas. Espere um minuto e tente de novo.';
    if (raw.includes('failed to fetch')) return 'Sem conexão com o servidor. Verifique a internet.';

    return error?.message || 'Não foi possível concluir. Tente novamente.';
}
