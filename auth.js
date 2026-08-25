import { supabase } from './supabase.js';

let isLogin = true;
const toggleBtn = document.getElementById('toggle-auth-mode');
const signupFields = document.getElementById('signup-fields');
const formTitle = document.getElementById('form-title');
const submitBtn = document.getElementById('auth-submit');

const togglePasswordBtn = document.getElementById('toggle-password');
const passwordInput = document.getElementById('auth-password');
if (togglePasswordBtn && passwordInput) {
    togglePasswordBtn.addEventListener('click', () => {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        togglePasswordBtn.innerText = type === 'password' ? 'VER' : 'OCULTAR';
    });
}

toggleBtn?.addEventListener('click', () => {
    isLogin = !isLogin;
    signupFields.style.display = isLogin ? 'none' : 'flex';
    formTitle.innerText = isLogin ? 'Entrar na sua conta' : 'Criar nova conta VIP';
    submitBtn.innerText = isLogin ? 'Entrar' : 'Validar Chave e Cadastrar';
    toggleBtn.innerHTML = isLogin ? 'Tem uma licença? <strong>Cadastre-se aqui</strong>' : 'Já tem conta? <strong>Entre</strong>';
});

document.getElementById('auth-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;

    submitBtn.innerText = "Processando..."; submitBtn.style.opacity = "0.7";

    if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            alert("Erro ao entrar. Verifique credenciais.");
            submitBtn.innerText = "Entrar"; submitBtn.style.opacity = "1";
        } else { window.location.href = 'dashboard.html'; }
    } else {
        const accessKey = document.getElementById('reg-access-key').value.trim();
        if (!accessKey) {
            alert("⚠️ Você precisa de uma Chave de Acesso para se cadastrar.");
            submitBtn.innerText = "Validar Chave e Cadastrar"; submitBtn.style.opacity = "1"; return;
        }

        const { data: keyData, error: keyError } = await supabase.from('access_keys').select('*').eq('key_code', accessKey).single();
        if (keyError || !keyData || keyData.is_active === false) {
            alert("❌ Chave de Acesso inválida ou já utilizada.");
            submitBtn.innerText = "Validar Chave e Cadastrar"; submitBtn.style.opacity = "1"; return;
        }

        const nome = document.getElementById('reg-name').value;
        const sobrenome = document.getElementById('reg-lastname').value;
        const conjuge = document.getElementById('reg-partner').value;
        const nascimento = document.getElementById('reg-birth').value;
        const casamento = document.getElementById('reg-wedding').value;

        const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) {
            alert("Erro: " + authError.message);
            submitBtn.innerText = "Validar Chave e Cadastrar"; submitBtn.style.opacity = "1"; return;
        }

        if (authData.user) {
            await supabase.from('access_keys').update({ is_active: false, used_by: email }).eq('key_code', accessKey);
            await supabase.from('users').insert([{
                id: authData.user.id, nome: nome, sobrenome: sobrenome, nomeConjuge: conjuge,
                dataNascimento: nascimento, dataCasamento: casamento, email: email, dataCriacao: new Date().toISOString()
            }]);
            window.location.href = 'dashboard.html';
        }
    }
});