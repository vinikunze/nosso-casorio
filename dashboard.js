import { supabase } from './supabase.js';

let currentUser = null, userData = {}, vendors = [], guests = [], tasks = [], rosEvents = [], timerInterval = null;
let editVendorIndex = -1;
let editGuestIndex = -1; // Nova variável global de controle para convidados!

// ==========================================
// 1. INICIALIZAÇÃO E TEMPO REAL
// ==========================================
supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) { currentUser = session.user; carregarNuvem(); iniciarEscutaEmTempoReal(); }
    else { window.location.href = 'index.html'; }
});

function iniciarEscutaEmTempoReal() {
    supabase.channel('schema-db-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => carregarNuvem()).subscribe();
}

async function carregarNuvem() {
    const { data } = await supabase.from('users').select('*').eq('id', currentUser.id).single();
    if (data) {
        userData = data; vendors = data.vendors || []; guests = data.guests || []; tasks = data.tasks || []; rosEvents = data.rosEvents || [];
        const casal = `${data.nome || "Noivo"} & ${data.nomeConjuge || "Noiva"}`;
        document.getElementById('sidebar-names-display').innerText = casal;
        const inputNomes = document.getElementById('names-input');
        if (inputNomes && document.activeElement !== inputNomes) inputNomes.value = casal;
        if (data.bgImage) document.getElementById('dynamic-bg').style.backgroundImage = `url(${data.bgImage})`;
        const inputData = document.getElementById('wedding-date-input');
        if (data.dataCasamento) { if (inputData && document.activeElement !== inputData) inputData.value = data.dataCasamento; }
        iniciarContagem(data.dataCasamento); renderTudo();
    }
}

async function salvarNuvem() {
    if (currentUser) await supabase.from('users').update({ vendors, guests, tasks, rosEvents }).eq('id', currentUser.id);
}

function renderTudo() { renderVendors(); renderGuests(); renderBebidas(); renderChecklist(); renderRos(); }

document.querySelectorAll('.nav-btn[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        btn.classList.add('active'); document.getElementById(btn.dataset.target).classList.add('active');
    });
});

document.getElementById('btn-logout')?.addEventListener('click', async () => { await supabase.auth.signOut(); window.location.href = 'index.html'; });

// ==========================================
// 3. CABEÇALHO E CRONÔMETRO
// ==========================================
const namesInput = document.getElementById('names-input');
if (namesInput) {
    namesInput.addEventListener('input', (e) => document.getElementById('sidebar-names-display').innerText = e.target.value);
    namesInput.addEventListener('blur', async (e) => { const nomes = e.target.value.split('&').map(n => n.trim()); await supabase.from('users').update({ nome: nomes[0] || "Noivo", nomeConjuge: nomes[1] || "Noiva" }).eq('id', currentUser.id); });
}

const dateInput = document.getElementById('wedding-date-input');
if (dateInput) { dateInput.addEventListener('change', async (e) => { const novaData = e.target.value; iniciarContagem(novaData); await supabase.from('users').update({ dataCasamento: novaData }).eq('id', currentUser.id); }); }

function iniciarContagem(dataString) {
    clearInterval(timerInterval);
    if (!dataString) {
        document.getElementById('t-days').innerText = '00'; document.getElementById('t-hours').innerText = '00'; document.getElementById('t-minutes').innerText = '00'; document.getElementById('t-seconds').innerText = '00'; return;
    }
    const targetDate = new Date(dataString).getTime(); if (isNaN(targetDate)) return;
    const atualizarRelogio = () => {
        const diff = targetDate - new Date().getTime();
        if (diff <= 0) { document.getElementById('t-days').innerText = '00'; document.getElementById('t-hours').innerText = '00'; document.getElementById('t-minutes').innerText = '00'; document.getElementById('t-seconds').innerText = '00'; clearInterval(timerInterval); return; }
        document.getElementById('t-days').innerText = String(Math.floor(diff / (1000 * 60 * 60 * 24))).padStart(2, '0');
        document.getElementById('t-hours').innerText = String(Math.floor((diff / (1000 * 60 * 60)) % 24)).padStart(2, '0');
        document.getElementById('t-minutes').innerText = String(Math.floor((diff / 1000 / 60) % 60)).padStart(2, '0');
        document.getElementById('t-seconds').innerText = String(Math.floor((diff / 1000) % 60)).padStart(2, '0');
    };
    timerInterval = setInterval(atualizarRelogio, 1000); atualizarRelogio();
}

document.getElementById('photo-upload')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const label = document.getElementById('upload-label').querySelector('.text');
    label.innerText = "⏳ Enviando...";
    try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("upload_preset", "SEU_UPLOAD_PRESET_AQUI");
        const res = await fetch(`https://api.cloudinary.com/v1_1/SEU_CLOUD_NAME_AQUI/image/upload`, { method: "POST", body: formData });
        const data = await res.json();
        await supabase.from('users').update({ bgImage: data.secure_url }).eq('id', currentUser.id);
        document.getElementById('dynamic-bg').style.backgroundImage = `url(${data.secure_url})`;
        label.innerText = "✅ Atualizado!";
    } catch { label.innerText = "❌ Erro"; }
    setTimeout(() => label.innerText = "ESCOLHER IMAGEM", 3000);
});

// ==========================================
// 4. FORNECEDORES E FLUXO DE CAIXA
// ==========================================
const vForm = document.getElementById('vendor-form'); const btnCancelEdit = document.getElementById('btn-cancel-edit'); const btnSubmitVendor = document.getElementById('btn-submit-vendor');

const renderCashflow = () => {
    const container = document.getElementById('monthly-cashflow-container'); if (!container) return;
    const monthsMap = {}; const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    vendors.forEach((v, vIdx) => {
        v.payments.forEach((p, pIdx) => {
            if (!p.date) return; const parts = p.date.split('-'); if (parts.length < 2) return;
            const year = parts[0], monthIdx = parseInt(parts[1]) - 1, key = `${year}-${parts[1]}`;
            if (!monthsMap[key]) monthsMap[key] = { label: `${monthNames[monthIdx]} ${year}`, total: 0, paid: 0, pending: 0, items: [] };
            const amt = parseFloat(p.amount || 0); monthsMap[key].total += amt;
            if (p.isPaid) monthsMap[key].paid += amt; else monthsMap[key].pending += amt;
            monthsMap[key].items.push({ vIdx, pIdx, vendorName: v.name, date: p.date, amount: amt, isPaid: p.isPaid, desc: p.desc });
        });
    });
    const sortedKeys = Object.keys(monthsMap).sort();
    if (sortedKeys.length === 0) { container.innerHTML = '<p style="color: var(--text-muted); grid-column: 1 / -1;">Nenhum pagamento programado no calendário ainda.</p>'; return; }
    container.innerHTML = sortedKeys.map(k => {
        const m = monthsMap[k]; m.items.sort((a, b) => a.date.localeCompare(b.date));
        const percent = m.total > 0 ? (m.paid / m.total) * 100 : 0; const isDone = m.pending === 0 && m.total > 0;
        const itemsHtml = m.items.map(item => {
            const formattedDate = item.date.split('-').reverse().join('/');
            return `<div class="installment-item" style="padding: 10px; margin-top: 8px; ${item.isPaid ? 'opacity: 0.5; border-color: var(--success-green);' : 'border-color: rgba(255,255,255,0.08);'}"><div style="display:flex; justify-content:space-between; align-items:center; width: 100%; gap: 10px;"><div style="display:flex; align-items:center; gap: 10px; min-width: 0; flex: 1;"><input type="checkbox" style="accent-color: var(--gold-primary); width: 16px; height: 16px; cursor: pointer; flex-shrink: 0;" ${item.isPaid ? 'checked' : ''} onchange="togglePay(${item.vIdx}, ${item.pIdx})"><div style="display:flex; flex-direction:column; min-width: 0; flex: 1;"><strong style="color: #fff; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${item.vendorName}">${item.vendorName}</strong><small style="color: var(--text-muted); font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.desc} • ${formattedDate}</small></div></div><strong style="color: ${item.isPaid ? 'var(--success-green)' : '#fff'}; font-size: 0.85rem; white-space: nowrap; flex-shrink: 0;">R$ ${item.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div></div>`;
        }).join('');
        return `<div style="background: rgba(0,0,0,0.2); border: 1px solid ${isDone ? 'var(--success-green)' : 'var(--glass-border)'}; border-radius: 8px; padding: 15px; display: flex; flex-direction: column;"><h4 style="color: var(--gold-light); margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px;">${m.label} ${isDone ? '✅' : ''}</h4><div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 5px;"><span style="color: var(--text-muted);">Total:</span><strong style="color: #fff;">R$ ${m.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div><div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 8px;"><span style="color: var(--text-muted);">Falta Pagar:</span><strong style="color: ${isDone ? 'var(--success-green)' : 'var(--danger-red)'};">R$ ${m.pending.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div><div class="progress-track" style="height: 4px; margin-bottom: 10px;"><div class="progress-fill" style="width: ${percent}%; background: ${isDone ? 'var(--success-green)' : 'var(--gold-primary)'};"></div></div><div style="flex-grow: 1; max-height: 220px; overflow-y: auto; overflow-x: hidden; padding-right: 5px; margin-top: 5px;">${itemsHtml}</div></div>`;
    }).join('');
};

const renderVendors = () => {
    const container = document.getElementById('vendors-list-container'); if (!container) return;
    let globalTotal = 0, globalPaid = 0;
    container.innerHTML = vendors.map((v, vIdx) => {
        let vendorPaid = 0; v.payments.forEach(p => { if (p.isPaid) vendorPaid += parseFloat(p.amount); });
        globalTotal += parseFloat(v.total || 0); globalPaid += vendorPaid; const percent = v.total > 0 ? (vendorPaid / v.total) * 100 : 0; const isDone = percent >= 100;
        return `<div class="premium-panel" style="margin-bottom: 2rem; border-color: ${isDone ? 'var(--success-green)' : 'var(--glass-border)'}">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 1rem;">
                <div><h3 style="color:var(--gold-primary); font-family: var(--font-serif); font-size: 1.5rem;">${v.name}</h3><small style="color:var(--text-muted); font-size: 0.75rem;">MODALIDADE: ${v.method}</small></div>
                <div style="text-align:right;"><div style="font-weight:bold; font-size: 1.2rem; color: #fff; margin-bottom: 10px;">Total: R$ ${parseFloat(v.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div><button class="btn-primary" style="padding: 4px 8px; font-size: 0.75rem; background: transparent; border: 1px solid var(--gold-primary); color: var(--gold-primary);" onclick="iniciarEdicaoFornecedor(${vIdx})">✏️ Editar</button> <button class="btn-primary" style="padding: 4px 8px; font-size: 0.75rem; background: transparent; border: 1px solid var(--danger-red); color: var(--danger-red);" onclick="excluirFornecedor(${vIdx})">✕ Excluir</button></div>
            </div>
            <div class="progress-container"><div class="progress-labels"><span>Progresso: ${Math.round(percent)}%</span><span>Pago: R$ ${vendorPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div><div class="progress-track"><div class="progress-fill" style="width: ${percent}%;"></div></div></div>
            <div style="margin-top: 1.5rem;">${v.payments.map((p, pIdx) => `<div class="installment-item" style="${p.isPaid ? 'opacity: 0.6; border-color: var(--success-green);' : ''}"><div style="display:flex; align-items:center; gap: 10px;"><input type="checkbox" style="accent-color: var(--gold-primary); width: 16px; height: 16px; cursor: pointer;" ${p.isPaid ? 'checked' : ''} onchange="togglePay(${vIdx},${pIdx})"> <strong style="color: #fff; font-size: 0.95rem;">${p.desc}</strong> <small style="color: var(--text-muted); font-size: 0.8rem;">(${p.date.split('-').reverse().join('/')})</small></div><div style="display:flex; align-items:center; gap: 15px;"><strong style="color: #fff; font-size: 0.95rem;">R$ ${parseFloat(p.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>${!p.isPaid ? `<a href="#" class="btn-primary" style="padding: 5px 10px; font-size: 0.75rem; border-radius: 4px;">📅 Agendar</a>` : `<span style="color:var(--success-green); font-size:0.8rem; font-weight:bold;">✔ Pago</span>`}</div></div>`).join('')}</div>
        </div>`;
    }).join('');
    document.getElementById('finance-total').innerText = `R$ ${globalTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`; document.getElementById('finance-paid').innerText = `R$ ${globalPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`; document.getElementById('finance-pending').innerText = `R$ ${(globalTotal - globalPaid).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    renderCashflow();
};

window.togglePay = async (vIdx, pIdx) => { vendors[vIdx].payments[pIdx].isPaid = !vendors[vIdx].payments[pIdx].isPaid; renderVendors(); await salvarNuvem(); };
window.excluirFornecedor = async (idx) => { if (confirm("Excluir fornecedor?")) { vendors.splice(idx, 1); renderVendors(); await salvarNuvem(); } };
window.iniciarEdicaoFornecedor = (idx) => {
    editVendorIndex = idx; const v = vendors[idx];
    document.getElementById('v-name').value = v.name; document.getElementById('v-method').value = v.method; document.getElementById('v-total').value = v.total; document.getElementById('v-installments').value = v.payments.length; document.getElementById('v-date').value = v.payments[0].date;
    document.getElementById('vendor-form-title').innerText = "✏️ Editando Fornecedor"; btnSubmitVendor.innerText = "Atualizar Contrato"; btnCancelEdit.style.display = 'block'; document.getElementById('vendors').scrollIntoView({ behavior: "smooth" });
};
btnCancelEdit?.addEventListener('click', () => { editVendorIndex = -1; vForm.reset(); document.getElementById('vendor-form-title').innerText = "+ Cadastrar Novo Fornecedor"; btnSubmitVendor.innerText = "Salvar Contrato de Fornecedor"; btnCancelEdit.style.display = 'none'; });

vForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const entry = parseFloat(document.getElementById('v-entry').value) || 0, total = parseFloat(document.getElementById('v-total').value), instCount = parseInt(document.getElementById('v-installments').value), firstDate = document.getElementById('v-date').value;
    let payments = []; if (entry > 0) payments.push({ desc: 'Entrada', amount: entry, date: firstDate, isPaid: false });
    for (let i = 1; i <= instCount; i++) { let d = new Date(firstDate + 'T12:00:00'); d.setMonth(d.getMonth() + (entry > 0 ? i : i - 1)); payments.push({ desc: `Parc ${i}/${instCount}`, amount: (total - entry) / instCount, date: d.toISOString().split('T')[0], isPaid: false }); }
    const novo = { name: document.getElementById('v-name').value, method: document.getElementById('v-method').value, total, payments };
    editVendorIndex >= 0 ? vendors[editVendorIndex] = novo : vendors.push(novo); renderVendors(); await salvarNuvem(); btnCancelEdit.click();
});

// ==========================================
// 5. CONVIDADOS E BEBIDAS (AGORA COM EDIÇÃO!)
// ==========================================
const gForm = document.getElementById('guest-form'), groupSelect = document.getElementById('g-group'), adultsInput = document.getElementById('g-adults');
groupSelect?.addEventListener('change', () => { if (groupSelect.value === "Padrinhos") adultsInput.value = 2; });

const renderGuests = () => {
    let totalA = 0, totalC = 0, totalConf = 0; const pList = [], gList = [];
    guests.forEach((g, i) => {
        const a = parseInt(g.adults || 0), c = parseInt(g.children || 0), t = a + c; totalA += a; totalC += c; if (g.status === 'Confirmado') totalConf += t;
        const telDisplay = g.phone && g.phone !== 'Não informado' ? `📞 ${g.phone} | ` : '';
        const html = `
        <div class="premium-panel" style="display:flex; justify-content:space-between; align-items:center; border-left: 4px solid ${g.status === 'Confirmado' ? 'var(--success-green)' : g.status === 'Recusado' ? 'var(--danger-red)' : 'var(--gold-primary)'}; padding: 1rem; margin-bottom:10px;">
            <div><h4 style="color:#fff;">${g.name}</h4><small style="color:var(--text-muted)">${telDisplay}${g.group} | Adultos: ${a} | Crianças: ${c}</small></div>
            <div style="display:flex; gap:10px;">
                <select onchange="updG(${i}, this.value)" class="premium-input" style="padding:5px;">
                    <option ${g.status === 'Pendente' ? 'selected' : ''}>Pendente</option>
                    <option ${g.status === 'Confirmado' ? 'selected' : ''}>Confirmado</option>
                    <option ${g.status === 'Recusado' ? 'selected' : ''}>Recusado</option>
                </select>
                <button onclick="iniciarEdicaoConvidado(${i})" style="background:none; border:none; color:var(--gold-primary); font-size:1.2rem; cursor:pointer;" title="Editar">✏️</button>
                <button onclick="delG(${i})" style="background:none; border:none; color:var(--danger-red); font-size:1.2rem; cursor:pointer;" title="Excluir">✕</button>
            </div>
        </div>`;
        g.group === 'Padrinhos' ? pList.push(html) : gList.push(html);
    });
    document.getElementById('padrinhos-list-container').innerHTML = pList.length > 0 ? pList.join('') : '<p style="color:var(--text-muted)">Nenhum padrinho adicionado.</p>';
    document.getElementById('guests-list-container').innerHTML = gList.length > 0 ? gList.join('') : '<p style="color:var(--text-muted)">Nenhum convidado adicionado.</p>';
    document.getElementById('guest-total').innerText = totalA + totalC; document.getElementById('guest-adults').innerText = totalA; document.getElementById('guest-children').innerText = totalC; document.getElementById('guest-confirmed').innerText = totalConf;
};

const renderBebidas = () => {
    const container = document.getElementById('drinks-summary-container'); if (!container) return;
    let totals = { beer: 0, soda: 0, juice: 0, water: 0, cocktail: 0 };
    guests.forEach(g => {
        if (g.beverages?.beer) totals.beer += (g.beverages.beer * 1.5);
        if (g.beverages?.soda) totals.soda += (g.beverages.soda * 0.6);
        if (g.beverages?.juice) totals.juice += (g.beverages.juice * 0.4);
        if (g.beverages?.water) totals.water += (g.beverages.water * 0.5);
        if (g.beverages?.cocktail) totals.cocktail += g.beverages.cocktail;
    });
    container.innerHTML = `<div class="premium-panel"><p class="time-label">🍺 Chopp / Cerveja</p><span class="gold-number">${Math.ceil(totals.beer)}L</span></div><div class="premium-panel"><p class="time-label">🥤 Refrigerante</p><span class="gold-number">${Math.ceil(totals.soda)}L</span></div><div class="premium-panel"><p class="time-label">🧃 Suco Natural</p><span class="gold-number">${Math.ceil(totals.juice)}L</span></div><div class="premium-panel"><p class="time-label">💧 Água Mineral</p><span class="gold-number">${Math.ceil(totals.water)}L</span></div><div class="premium-panel"><p class="time-label">🍸 Drinks (Qtd Pessoas)</p><span class="gold-number">${totals.cocktail}</span></div>`;
};

window.updG = async (i, s) => { guests[i].status = s; renderGuests(); renderBebidas(); await salvarNuvem(); };
window.delG = async (i) => { if (confirm("Remover convidado?")) { guests.splice(i, 1); renderGuests(); renderBebidas(); await salvarNuvem(); } };

// NOVA FUNÇÃO: Iniciar a Edição do Convidado
window.iniciarEdicaoConvidado = (idx) => {
    editGuestIndex = idx;
    const g = guests[idx];

    document.getElementById('g-name').value = g.name;
    document.getElementById('g-phone').value = g.phone !== 'Não informado' ? g.phone : '';
    document.getElementById('g-group').value = g.group;
    document.getElementById('g-adults').value = g.adults || 0;
    document.getElementById('g-children').value = g.children || 0;

    document.getElementById('drink-beer').value = g.beverages?.beer || 0;
    document.getElementById('drink-cocktail').value = g.beverages?.cocktail || 0;
    document.getElementById('drink-soda').value = g.beverages?.soda || 0;
    document.getElementById('drink-juice').value = g.beverages?.juice || 0;
    document.getElementById('drink-water').value = g.beverages?.water || 0;

    document.getElementById('btn-submit-guest').innerText = "Atualizar Convidado";
    document.getElementById('btn-cancel-edit-guest').style.display = 'block';
    document.getElementById('guest-form').scrollIntoView({ behavior: "smooth" });
};

// Cancelar Edição do Convidado
document.getElementById('btn-cancel-edit-guest')?.addEventListener('click', () => {
    editGuestIndex = -1;
    gForm.reset();

    document.getElementById('drink-cocktail').value = 0; document.getElementById('drink-beer').value = 0; document.getElementById('drink-soda').value = 0; document.getElementById('drink-juice').value = 0; document.getElementById('drink-water').value = 0;
    document.getElementById('g-group').value = "Família"; if (adultsInput) adultsInput.value = 1;

    document.getElementById('btn-submit-guest').innerText = "Adicionar à Lista";
    document.getElementById('btn-cancel-edit-guest').style.display = 'none';
});

// Submit: Agora serve para Adicionar E Atualizar
gForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const novoG = {
        name: document.getElementById('g-name').value,
        phone: document.getElementById('g-phone').value || 'Não informado',
        group: document.getElementById('g-group').value,
        adults: parseInt(document.getElementById('g-adults').value) || 0,
        children: parseInt(document.getElementById('g-children').value) || 0,
        beverages: {
            cocktail: parseInt(document.getElementById('drink-cocktail').value) || 0,
            beer: parseInt(document.getElementById('drink-beer').value) || 0,
            soda: parseInt(document.getElementById('drink-soda').value) || 0,
            juice: parseInt(document.getElementById('drink-juice').value) || 0,
            water: parseInt(document.getElementById('drink-water').value) || 0
        },
        status: editGuestIndex >= 0 ? guests[editGuestIndex].status : 'Pendente' // Mantém o status original se for edição
    };

    if (editGuestIndex >= 0) {
        guests[editGuestIndex] = novoG; // Atualiza o existente
        editGuestIndex = -1;
        document.getElementById('btn-submit-guest').innerText = "Adicionar à Lista";
        document.getElementById('btn-cancel-edit-guest').style.display = 'none';
    } else {
        guests.push(novoG); // Adiciona novo
    }

    renderGuests(); renderBebidas(); await salvarNuvem(); gForm.reset();
    document.getElementById('drink-cocktail').value = 0; document.getElementById('drink-beer').value = 0; document.getElementById('drink-soda').value = 0; document.getElementById('drink-juice').value = 0; document.getElementById('drink-water').value = 0;
    document.getElementById('g-group').value = "Família"; if (adultsInput) adultsInput.value = 1;
});

// ==========================================
// 6. CHECKLIST
// ==========================================
const taskInput = document.getElementById('new-task-input'), btnAddTask = document.getElementById('btn-add-task');
const renderChecklist = () => {
    const container = document.getElementById('checklist-container'); if (!container) return;
    let completed = 0;
    container.innerHTML = tasks.map((task, index) => {
        const isDone = (task.status === 'Concluído' || task.status === 'Pago'); if (isDone) completed++;
        let bColor = 'transparent'; if (task.status === 'Pendente') bColor = '#facc15'; if (task.status === 'Pagando') bColor = '#60a5fa'; if (task.status === 'Pago' || task.status === 'Concluído') bColor = 'var(--success-green)';
        return `<div class="premium-panel" style="border-left: 4px solid ${bColor}; opacity: ${isDone ? '0.5' : '1'}; display: flex; justify-content: space-between; align-items: center; padding: 1rem; margin-bottom: 10px;"><span style="${isDone ? 'text-decoration: line-through; color: var(--text-muted);' : 'color: var(--text-light);'};">${task.text}</span><div style="display: flex; gap: 10px; align-items: center;"><select onchange="updateTaskStatus(${index}, this.value)" class="premium-input" style="padding: 5px;"><option value="Pendente" ${task.status === 'Pendente' ? 'selected' : ''}>⏳ Pendente</option><option value="Pagando" ${task.status === 'Pagando' ? 'selected' : ''}>💸 Pagando</option><option value="Pago" ${task.status === 'Pago' ? 'selected' : ''}>✅ Pago</option><option value="Concluído" ${task.status === 'Concluído' ? 'selected' : ''}>✅ Concluído</option></select><button onclick="deleteTask(${index})" style="background:none; border:none; color:var(--danger-red); cursor:pointer;">✕</button></div></div>`;
    }).join('');
    const percent = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
    document.getElementById('checklist-percent').innerText = `${percent}%`; document.getElementById('checklist-bar').style.width = `${percent}%`;
};
window.updateTaskStatus = async (i, newStatus) => { tasks[i].status = newStatus; renderChecklist(); await salvarNuvem(); };
window.deleteTask = async (i) => { tasks.splice(i, 1); renderChecklist(); await salvarNuvem(); };
const addTaskEvent = async () => { const txt = taskInput.value.trim(); if (txt) { tasks.push({ text: txt, status: 'Pendente' }); taskInput.value = ''; renderChecklist(); await salvarNuvem(); } };
if (btnAddTask) btnAddTask.onclick = addTaskEvent; if (taskInput) taskInput.onkeypress = (e) => { if (e.key === 'Enter') addTaskEvent(); };

// ==========================================
// 7. RUN OF SHOW
// ==========================================
const renderRos = () => {
    const container = document.getElementById('ros-timeline'); if (!container) return;
    rosEvents.sort((a, b) => a.time.localeCompare(b.time)); let html = '<div style="position:absolute; left:80px; top:0; bottom:0; width:2px; background:var(--gold-primary); opacity:0.5;"></div>';
    rosEvents.forEach((ev, i) => {
        let bColor = ev.role === 'noiva' ? '#fbcfe8' : (ev.role === 'noivo' ? '#bfdbfe' : 'var(--gold-primary)'), badgeText = ev.role === 'noiva' ? '👰 NOIVA' : (ev.role === 'noivo' ? '🤵 NOIVO' : '💍 AMBOS');
        html += `<div style="display:flex; align-items:center; margin-bottom:1.5rem; position:relative; z-index:2;"><div style="width:65px; text-align:right; font-family:var(--font-serif); font-size:1.4rem; color:var(--gold-primary); padding-right:15px;">${ev.time}</div><div style="width:14px; height:14px; border-radius:50%; background:var(--gold-primary); position:absolute; left:74px;"></div><div class="premium-panel" style="flex:1; margin-left:35px; border-left: 4px solid ${bColor}; display:flex; justify-content:space-between; align-items:center; padding:1rem;"><div><span style="font-size:0.7rem; padding:3px 8px; background:rgba(255,255,255,0.1); border-radius:4px; color:${bColor};">${badgeText}</span><h4 style="margin:5px 0 0 0;">${ev.desc}</h4></div><button onclick="deleteRos(${i})" style="background:none; border:none; color:var(--danger-red); font-size:1.2rem; cursor:pointer;">✕</button></div></div>`;
    }); container.innerHTML = html;
};
window.deleteRos = async (i) => { if (confirm("Excluir item?")) { rosEvents.splice(i, 1); renderRos(); await salvarNuvem(); } };
document.getElementById('btn-add-ros')?.addEventListener('click', async () => { const time = document.getElementById('ros-time').value, role = document.getElementById('ros-role').value, desc = document.getElementById('ros-desc').value.trim(); if (time && desc) { rosEvents.push({ time, role, desc }); document.getElementById('ros-desc').value = ''; renderRos(); await salvarNuvem(); } });

// ==========================================
// 8. MOTOR DE PDF AWWWARDS
// ==========================================
const gerarPdfPremium = (titulo, htmlConteudo, nomeArquivo, btnElement, textoOriginal) => {
    try {
        if (typeof html2pdf === 'undefined') { alert("A biblioteca de PDF ainda está carregando. Tente novamente em 2 segundos."); btnElement.innerHTML = textoOriginal; btnElement.style.opacity = '1'; return; }
        const coupleNames = (userData && userData.nome && userData.nomeConjuge) ? `${userData.nome} & ${userData.nomeConjuge}` : "Planejamento do Casamento";
        const containerPdf = document.createElement('div');
        containerPdf.innerHTML = `<style>* { box-sizing: border-box; } .pdf-wrapper { font-family: 'Inter', sans-serif; background: #ffffff; width: 100%; color: #111827; } .pdf-header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #DCA54C; padding-bottom: 20px; } .pdf-header h1 { font-family: 'Playfair Display', serif; color: #B8860B; font-size: 26px; margin: 0 0 8px 0; letter-spacing: -0.5px; } .pdf-header p { font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: 2px; margin: 0; font-weight: 600; } .pdf-summary { display: flex; justify-content: space-between; background: #F8F9FA; border: 1px solid #E5E7EB; border-radius: 8px; padding: 15px 20px; margin-bottom: 30px; flex-wrap: wrap; gap: 10px; } .summary-box { text-align: center; flex: 1; border-right: 1px solid #E5E7EB; min-width: 100px; } .summary-box:last-child { border-right: none; } .summary-box span { display: block; font-size: 10px; text-transform: uppercase; color: #6B7280; letter-spacing: 1px; margin-bottom: 5px; font-weight: 600; } .summary-box strong { font-family: 'Playfair Display', serif; font-size: 22px; color: #111827; } .summary-box.highlight strong { color: #059669; } .pdf-section-title { font-family: 'Playfair Display', serif; color: #DCA54C; font-size: 18px; margin: 25px 0 10px 0; border-bottom: 1px solid #E5E7EB; padding-bottom: 5px; } .pdf-table { width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 11px; } .pdf-table th { background-color: #F8F9FA; color: #374151; text-transform: uppercase; letter-spacing: 1px; font-size: 9px; padding: 12px 10px; text-align: left; border-top: 1px solid #E5E7EB; border-bottom: 2px solid #D1D5DB; } .pdf-table td { padding: 12px 10px; border-bottom: 1px solid #F3F4F6; color: #6B7280; } .pdf-table td.name-col { font-weight: 600; color: #111827; } .pdf-table td.mono { font-family: monospace; font-size: 10px; } .center { text-align: center !important; } .badge { padding: 4px 8px; border-radius: 4px; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; } .confirmado { background: #D1FAE5; color: #059669; border: 1px solid #A7F3D0; } .pendente { background: #FEF3C7; color: #92400E; border: 1px solid #FDE68A; } .recusado { background: #FEE2E2; color: #991B1B; border: 1px solid #FECACA; }</style><div class="pdf-wrapper"><div class="pdf-header"><h1>${titulo}</h1><p>${coupleNames} • ${new Date().toLocaleDateString('pt-BR')}</p></div>${htmlConteudo}</div>`;
        html2pdf().set({ margin: 10, filename: nomeArquivo, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true, letterRendering: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(containerPdf).save().then(() => { btnElement.innerHTML = '<span class="icon">✅</span> Baixado!'; setTimeout(() => { btnElement.innerHTML = textoOriginal; btnElement.style.opacity = '1'; }, 3000); });
    } catch (e) { console.error(e); alert("Erro na biblioteca do PDF."); }
};

document.getElementById('btn-export-pdf')?.addEventListener('click', () => {
    const btn = document.getElementById('btn-export-pdf'); const originalText = btn.innerHTML; btn.innerHTML = '<span class="icon">⏳</span> Gerando...'; btn.style.opacity = '0.7';
    let tA = 0, tC = 0, tConf = 0; guests.forEach(g => { tA += parseInt(g.adults || 0); tC += parseInt(g.children || 0); if (g.status === 'Confirmado') tConf += (parseInt(g.adults || 0) + parseInt(g.children || 0)); });
    const padrinhos = guests.filter(g => g.group === 'Padrinhos'); const normais = guests.filter(g => g.group !== 'Padrinhos');
    const gerarLinhas = (lista) => lista.map(g => `<tr><td class="name-col">${g.name}</td><td class="mono">${g.phone || '—'}</td><td>${g.group}</td><td class="center">${g.adults}</td><td class="center">${g.children}</td><td class="center"><span class="badge ${g.status.toLowerCase()}">${g.status}</span></td></tr>`).join('');
    const conteudo = `<div class="pdf-summary"><div class="summary-box"><span>Geral</span><strong>${tA + tC}</strong></div><div class="summary-box"><span>Adultos</span><strong>${tA}</strong></div><div class="summary-box"><span>Crianças</span><strong>${tC}</strong></div><div class="summary-box highlight"><span>Confirmados</span><strong>${tConf}</strong></div></div>${padrinhos.length > 0 ? `<h3 class="pdf-section-title">💍 Padrinhos</h3><table class="pdf-table"><thead><tr><th>Nome / Família</th><th>Telefone</th><th>Grupo</th><th class="center">Adultos</th><th class="center">Crianças</th><th class="center">Status</th></tr></thead><tbody>${gerarLinhas(padrinhos)}</tbody></table>` : ''}<h3 class="pdf-section-title">💌 Demais Convidados</h3><table class="pdf-table"><thead><tr><th>Nome / Família</th><th>Telefone</th><th>Grupo</th><th class="center">Adultos</th><th class="center">Crianças</th><th class="center">Status</th></tr></thead><tbody>${gerarLinhas(normais)}</tbody></table>`;
    gerarPdfPremium("Lista Oficial de Convidados", conteudo, "Convidados_WeddingPro.pdf", btn, originalText);
});

document.getElementById('btn-export-vendors-pdf')?.addEventListener('click', () => {
    const btn = document.getElementById('btn-export-vendors-pdf'); const originalText = btn.innerHTML; btn.innerHTML = '<span class="icon">⏳</span> Gerando...'; btn.style.opacity = '0.7';
    let globalTotal = 0, globalPaid = 0; const monthsMap = {}; const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    vendors.forEach(v => { globalTotal += parseFloat(v.total || 0); v.payments.forEach(p => { if (p.isPaid) globalPaid += parseFloat(p.amount || 0); if (!p.date) return; const parts = p.date.split('-'); if (parts.length < 2) return; const key = `${parts[0]}-${parts[1]}`; if (!monthsMap[key]) monthsMap[key] = { label: `${monthNames[parseInt(parts[1]) - 1]} ${parts[0]}`, pending: 0 }; if (!p.isPaid) monthsMap[key].pending += parseFloat(p.amount || 0); }); });
    let monthlyHtml = '<div class="pdf-summary" style="margin-top: 15px; margin-bottom: 30px;">'; Object.keys(monthsMap).sort().forEach(k => { const m = monthsMap[k]; monthlyHtml += `<div class="summary-box"><span>${m.label}</span><strong style="font-size:14px; color:${m.pending === 0 ? '#059669' : '#991B1B'}">Falta: R$ ${m.pending.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div>`; }); monthlyHtml += '</div>';
    const conteudo = `<div class="pdf-summary" style="margin-bottom: 10px;"><div class="summary-box"><span>Investimento Total</span><strong>R$ ${globalTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div><div class="summary-box highlight"><span>Total Pago</span><strong>R$ ${globalPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div><div class="summary-box"><span>Falta Pagar</span><strong style="color:#991B1B;">R$ ${(globalTotal - globalPaid).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div></div><h3 class="pdf-section-title" style="font-size: 14px; margin-top: 10px;">Projeção de Fluxo de Caixa Mensal</h3>${Object.keys(monthsMap).length > 0 ? monthlyHtml : '<p style="font-size: 10px; color: #666;">Nenhuma parcela pendente projetada.</p>'}<table class="pdf-table"><thead><tr><th>Fornecedor</th><th>Forma Pgt.</th><th>Valor Total</th><th>Valor Pago</th><th>Pendente</th></tr></thead><tbody>${vendors.map(v => { let pago = 0; v.payments.forEach(p => { if (p.isPaid) pago += p.amount; }); return `<tr><td class="name-col">${v.name}</td><td>${v.method}</td><td class="mono">R$ ${parseFloat(v.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td><td class="mono" style="color:#059669;">R$ ${pago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td><td class="mono" style="color:#991B1B;">R$ ${(parseFloat(v.total || 0) - pago).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td></tr>`; }).join('')}</tbody></table>`;
    gerarPdfPremium("Relatório Financeiro de Fornecedores", conteudo, "Fornecedores_WeddingPro.pdf", btn, originalText);
});

document.getElementById('btn-export-drinks-pdf')?.addEventListener('click', () => {
    const btn = document.getElementById('btn-export-drinks-pdf'); const originalText = btn.innerHTML; btn.innerHTML = '<span class="icon">⏳</span> Gerando...'; btn.style.opacity = '0.7';
    let totals = { beer: 0, soda: 0, juice: 0, water: 0, cocktail: 0 };
    guests.forEach(g => { if (g.beverages?.beer) totals.beer += (g.beverages.beer * 1.5); if (g.beverages?.soda) totals.soda += (g.beverages.soda * 0.6); if (g.beverages?.juice) totals.juice += (g.beverages.juice * 0.4); if (g.beverages?.water) totals.water += (g.beverages.water * 0.5); if (g.beverages?.cocktail) totals.cocktail += g.beverages.cocktail; });
    const conteudo = `<div class="pdf-summary" style="flex-wrap: wrap; gap: 10px;"><div class="summary-box"><span>🍺 Chopp / Cerveja</span><strong>${Math.ceil(totals.beer)} L</strong></div><div class="summary-box"><span>🥤 Refrigerante</span><strong>${Math.ceil(totals.soda)} L</strong></div><div class="summary-box"><span>🧃 Suco Natural</span><strong>${Math.ceil(totals.juice)} L</strong></div><div class="summary-box"><span>💧 Água Mineral</span><strong>${Math.ceil(totals.water)} L</strong></div><div class="summary-box"><span>🍸 Serviço Bar (Drinks)</span><strong>${totals.cocktail} Pessoas</strong></div></div><h3 class="pdf-section-title">Consumo Detalhado da Lista</h3><table class="pdf-table"><thead><tr><th>Nome / Família</th><th class="center">Status</th><th class="center">Qtd Chopp</th><th class="center">Qtd Refri</th><th class="center">Qtd Suco</th><th class="center">Qtd Água</th><th class="center">Qtd Drinks</th></tr></thead><tbody>${guests.map(g => `<tr><td class="name-col">${g.name}</td><td class="center"><span class="badge ${g.status.toLowerCase()}">${g.status}</span></td><td class="center">${g.beverages?.beer || '0'}</td><td class="center">${g.beverages?.soda || '0'}</td><td class="center">${g.beverages?.juice || '0'}</td><td class="center">${g.beverages?.water || '0'}</td><td class="center">${g.beverages?.cocktail || '0'}</td></tr>`).join('')}</tbody></table>`;
    gerarPdfPremium("Lista de Compras: Bebidas", conteudo, "Bebidas_WeddingPro.pdf", btn, originalText);
});