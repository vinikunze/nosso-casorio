import * as db from './db.js';
import { exportFinancePdf, exportGuestsPdf, exportVendorsPdf } from './export-pdf.js';

// ==========================================================
// Estado
// ==========================================================

const state = {
    userId: null,
    role: null,
    wedding: null,
    private: null,
    members: [],
    vendors: [],
    guests: [],
    tasks: [],
    runOfShow: [],
    // Pagamentos sem valores, para a cerimonialista.
    paymentStatus: [],
    editingVendorId: null,
    editingVendorInputs: null,
    editingContactId: null,
    editingGuestId: null,
    vendorFilter: 'all',
    guestFilter: 'all',
    countdownTimer: null,
    unsubscribe: null,
    reloading: false,
    reloadQueued: false
};

const CATEGORY_LABELS = {
    venue: 'Espaço / Local', buffet: 'Buffet', bar: 'Bar e bebidas', cake: 'Bolo e doces',
    decor: 'Decoração', photo: 'Foto e vídeo', music: 'Música / DJ', sound: 'Som e iluminação',
    attire: 'Traje e beleza', rings: 'Alianças', invites: 'Convites e papelaria',
    transport: 'Transporte', church: 'Cerimônia', other: 'Outros'
};

// A ordem define a ordem da lista: urgente primeiro, certo por último.
const VENDOR_STATUS = {
    urgent: { label: 'Urgente', badge: 'danger', row: 'declined' },
    pending: { label: 'Falta acertar', badge: 'warning', row: 'pending' },
    paying: { label: 'Estamos pagando', badge: 'info', row: 'in_progress' },
    ok: { label: 'Tudo certo', badge: 'success', row: 'confirmed' }
};
const VENDOR_STATUS_ORDER = Object.keys(VENDOR_STATUS);

const GUEST_STATUS = {
    pending: { label: 'Pendente', badge: 'warning' },
    confirmed: { label: 'Confirmado', badge: 'success' },
    declined: { label: 'Não vai', badge: 'danger' }
};

const TASK_STATUS = {
    pending: { label: 'Pendente', badge: 'warning' },
    in_progress: { label: 'Em andamento', badge: 'info' },
    done: { label: 'Concluído', badge: 'success' }
};

const ROS_ROLE = { bride: '👰 Noiva', groom: '🤵 Noivo', both: '💍 Os dois' };

const ROLE_LABELS = {
    owner: 'Dono',
    editor: 'Acesso total',
    planner: 'Cerimonialista',
    viewer: 'Só vê'
};

// Litros por pessoa marcada em cada bebida.
const DRINK_RATIOS = { beer: 1.5, soda: 0.6, juice: 0.4, water: 0.5 };

// ==========================================================
// Permissões
// O banco é quem garante (RLS). Aqui é só para não mostrar botão que
// não vai funcionar nem tela que voltaria vazia. A cerimonialista vê todas
// as abas; o que é dinheiro ou edição do casal some para ela.
// ==========================================================

const can = {
    seeFinance: () => ['owner', 'editor', 'viewer'].includes(state.role),
    editWedding: () => ['owner', 'editor'].includes(state.role),
    plan: () => ['owner', 'editor', 'planner'].includes(state.role),
    manageMembers: () => state.role === 'owner'
};

function applyRole() {
    const toggle = (selector, visible) =>
        document.querySelectorAll(selector).forEach((element) => { element.hidden = !visible; });

    toggle('[data-finance]', can.seeFinance());
    toggle('[data-planner]', !can.seeFinance());
    toggle('[data-couple]', can.editWedding());
    toggle('[data-owner]', can.manageMembers());

    // Dados do casamento: a cerimonialista vê, mas não edita.
    $('wedding-form').querySelectorAll('input').forEach((input) => { input.disabled = !can.editWedding(); });

    const financeLabel = can.seeFinance() ? 'Valores' : 'Pagamentos';
    $('nav-finance-label').textContent = financeLabel;
    $('finance-title').textContent = financeLabel;
    $('finance-sub').textContent = can.seeFinance()
        ? 'Fornecedores, contratos e o carnê de cada um.'
        : 'Quem já foi pago e o que vence quando — sem os valores.';

    $('role-label').textContent = state.role === 'owner' ? '' : ROLE_LABELS[state.role] ?? '';

    // Se a aba aberta sumiu (o papel mudou), volta para a visão geral.
    const active = document.querySelector('.tab.active');
    if (active?.hidden) showTab('overview');
}

// ==========================================================
// Utilidades
// ==========================================================

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
    ));
}

function money(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL', minimumFractionDigits: 2
    });
}

function num(value) {
    return Number(value || 0);
}

/** Datas do banco vêm como 'YYYY-MM-DD'; monta a data no fuso local, sem UTC. */
function parseDate(isoDate) {
    if (!isoDate) return null;
    const [year, month, day] = String(isoDate).slice(0, 10).split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}

function formatDate(isoDate) {
    const date = parseDate(isoDate);
    return date ? date.toLocaleDateString('pt-BR') : '—';
}

function formatLongDate(isoDate) {
    const date = parseDate(isoDate);
    if (!date) return '';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatTime(value) {
    return value ? String(value).slice(0, 5) : '';
}

function todayIso() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

/** Soma meses sem estourar o fim do mês (31/01 + 1 mês = 28/02, não 03/03). */
function addMonths(isoDate, months) {
    const date = parseDate(isoDate);
    if (!date) return null;

    const targetDay = date.getDate();
    const shifted = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
    shifted.setDate(Math.min(targetDay, lastDay));

    const month = String(shifted.getMonth() + 1).padStart(2, '0');
    const day = String(shifted.getDate()).padStart(2, '0');
    return `${shifted.getFullYear()}-${month}-${day}`;
}

function isOverdue(payment) {
    return !payment.is_paid && payment.due_date && payment.due_date < todayIso();
}

/** Número para o link do WhatsApp: só dígitos, com 55 na frente se for número brasileiro sem DDI. */
function whatsappNumber(phone) {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    if (digits.length >= 12) return digits;
    return null;
}

function statusOptions(map, current) {
    return Object.entries(map).map(([value, info]) =>
        `<option value="${value}" ${current === value ? 'selected' : ''}>${info.label}</option>`
    ).join('');
}

let toastTimer = null;
function toast(message, kind = '') {
    const element = $('toast');
    element.textContent = message;
    element.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { element.className = 'toast'; }, 3600);
}

function setSync(status) {
    const element = $('sync-status');
    if (!element) return;
    const map = {
        saving: ['Salvando...', 'saving'],
        ok: ['Sincronizado', ''],
        error: ['Erro ao salvar', 'error']
    };
    const [text, cls] = map[status] ?? map.ok;
    element.textContent = text;
    element.className = `sync-status ${cls}`;
}

/** Envolve uma escrita: mostra estado, recarrega e avisa em caso de erro. */
async function mutate(action, successMessage) {
    setSync('saving');
    try {
        await action();
        await reload();
        setSync('ok');
        if (successMessage) toast(successMessage, 'success');
        return true;
    } catch (error) {
        console.error(error);
        setSync('error');
        toast(error?.message || 'Não foi possível salvar.', 'error');
        return false;
    }
}

// ==========================================================
// Inicialização
// ==========================================================

async function boot() {
    const session = await db.getSession();
    if (!session) {
        window.location.replace('index.html');
        return;
    }
    state.userId = session.user.id;

    try {
        // Quem foi convidado por e-mail entra direto, sem colar código.
        await db.claimInvites().catch((error) => console.error('Convites', error));
        state.wedding = await db.fetchWedding();
    } catch (error) {
        console.error(error);
        toast('Não foi possível falar com o servidor.', 'error');
    }

    if (!state.wedding) {
        showGate();
        return;
    }

    await reload();

    $('boot-screen').hidden = true;
    $('app').hidden = false;

    state.unsubscribe = db.subscribeToChanges(() => reload());
    wireEvents();
}

/** Recarrega tudo; chamadas concorrentes viram uma só recarga extra. */
async function reload() {
    if (state.reloading) {
        state.reloadQueued = true;
        return;
    }
    state.reloading = true;

    try {
        state.wedding = (await db.fetchWedding()) ?? state.wedding;
        if (!state.wedding) return;

        // As tabelas de valores voltam vazias para a cerimonialista (RLS),
        // então dá para buscar tudo junto sem perguntar o papel antes.
        const id = state.wedding.id;
        const [vendors, guests, tasks, runOfShow, members, privateData] = await Promise.all([
            db.fetchVendors(id),
            db.fetchGuests(id),
            db.fetchTasks(id),
            db.fetchRunOfShow(id),
            db.fetchMembers(id),
            db.fetchWeddingPrivate(id)
        ]);

        state.vendors = vendors;
        state.guests = guests;
        state.tasks = tasks;
        state.runOfShow = runOfShow;
        state.members = members;
        state.private = privateData;

        const me = members.find((m) => m.user_id === state.userId && m.invite_status === 'accepted');
        state.role = me?.role ?? (state.wedding.owner_id === state.userId ? 'owner' : 'viewer');

        // A cerimonialista não lê as tabelas de valores; busca o andamento
        // por uma função que devolve tudo menos o dinheiro.
        if (!can.seeFinance()) {
            state.paymentStatus = await db.fetchPaymentStatus(id);
        }

        renderAll();
    } catch (error) {
        console.error(error);
        toast('Falha ao carregar os dados.', 'error');
    } finally {
        state.reloading = false;
        if (state.reloadQueued) {
            state.reloadQueued = false;
            reload();
        }
    }
}

// ==========================================================
// Tela de vínculo (sem casamento ainda)
// ==========================================================

function showGate() {
    $('boot-screen').hidden = true;
    $('gate-screen').hidden = false;

    const feedback = $('gate-feedback');
    const say = (message, kind = 'error') => {
        feedback.textContent = message;
        feedback.className = `auth-feedback is-visible ${kind}`;
    };

    $('btn-accept-invite').addEventListener('click', async () => {
        const token = $('invite-code').value.trim();
        if (!token) return say('Cole o código do convite.');

        try {
            await db.acceptInvite(token);
            window.location.reload();
        } catch (error) {
            say(error?.message || 'Convite inválido.');
        }
    });

    $('btn-create-wedding').addEventListener('click', async () => {
        const partner1Name = $('new-partner1').value.trim();
        const partner2Name = $('new-partner2').value.trim();
        if (!partner1Name || !partner2Name) return say('Preencha os dois nomes.');

        try {
            await db.createWedding({ partner1Name, partner2Name, weddingDate: $('new-date').value });
            window.location.reload();
        } catch (error) {
            say(error?.message || 'Não foi possível criar.');
        }
    });

    $('btn-gate-logout').addEventListener('click', async () => {
        await db.signOut();
        window.location.replace('index.html');
    });
}

// ==========================================================
// Cálculos
// ==========================================================

function vendorTotals(vendor) {
    const payments = vendor.payments ?? [];
    const scheduled = payments.reduce((sum, p) => sum + num(p.amount), 0);
    const paid = payments.filter((p) => p.is_paid).reduce((sum, p) => sum + num(p.amount), 0);
    const contracted = num(vendor.total_amount);

    return {
        contracted,
        scheduled,
        paid,
        pending: scheduled - paid,
        percent: contracted > 0 ? Math.min(100, (paid / contracted) * 100) : 0,
        settled: contracted > 0 && paid >= contracted - 0.005
    };
}

function financeSummary() {
    let contracted = 0;
    let scheduled = 0;
    let paid = 0;
    let overdue = 0;

    for (const vendor of state.vendors) {
        const totals = vendorTotals(vendor);
        contracted += totals.contracted;
        scheduled += totals.scheduled;
        paid += totals.paid;
        overdue += (vendor.payments ?? [])
            .filter(isOverdue)
            .reduce((sum, p) => sum + num(p.amount), 0);
    }

    const budget = num(state.private?.estimated_budget);

    return {
        budget,
        contracted,
        scheduled,
        paid,
        pending: scheduled - paid,
        overdue,
        remainingBudget: budget - contracted
    };
}

function guestTotals() {
    let adults = 0;
    let children = 0;
    let confirmed = 0;
    let pending = 0;
    let invitesSent = 0;
    let toInvite = 0;

    for (const guest of state.guests) {
        const a = num(guest.adults);
        const c = num(guest.children);
        adults += a;
        children += c;
        if (guest.status === 'confirmed') confirmed += a + c;
        if (guest.status === 'pending') pending += a + c;
        // Convite é por linha da lista (uma família = um convite).
        if (guest.invite_sent) invitesSent += 1;
        else if (guest.status !== 'declined') toInvite += 1;
    }

    return {
        adults, children, total: adults + children, confirmed, pending,
        invitesSent, toInvite, invitations: state.guests.length
    };
}

function vendorCounts() {
    const counts = { total: state.vendors.length, ok: 0, paying: 0, pending: 0, urgent: 0 };
    for (const vendor of state.vendors) counts[vendor.status] = (counts[vendor.status] ?? 0) + 1;
    return counts;
}

function sortedVendors(list = state.vendors) {
    return [...list].sort((a, b) =>
        VENDOR_STATUS_ORDER.indexOf(a.status) - VENDOR_STATUS_ORDER.indexOf(b.status)
        || a.name.localeCompare(b.name, 'pt-BR'));
}

function allPayments() {
    return state.vendors.flatMap((vendor) =>
        (vendor.payments ?? []).map((payment) => ({ ...payment, vendorName: vendor.name }))
    );
}

// ==========================================================
// Render
// ==========================================================

function renderAll() {
    applyRole();
    renderHeader();
    renderOverview();
    renderVendorDirectory();
    if (can.seeFinance()) renderFinance();
    else renderPaymentStatus();
    renderGuests();
    renderChecklist();
    renderRunOfShow();
    renderSettings();
}

function renderHeader() {
    const wedding = state.wedding;
    const names = `${wedding.partner1_name} & ${wedding.partner2_name}`;
    $('couple-names').textContent = names;

    const parts = [];
    if (wedding.wedding_date) parts.push(formatDate(wedding.wedding_date));
    if (wedding.city) parts.push(wedding.city);
    $('wedding-subtitle').textContent = parts.join(' · ')
        || (can.editWedding() ? 'Defina a data em Configurações' : 'Data a definir');

    document.title = `${names} | Nosso Casório`;

    if (wedding.cover_image_url) {
        document.body.style.backgroundImage =
            `linear-gradient(rgba(11,10,15,0.93), rgba(11,10,15,0.97)), url("${wedding.cover_image_url}")`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
    }

    startCountdown(wedding.wedding_date, wedding.ceremony_time);
}

function startCountdown(isoDate, ceremonyTime) {
    clearInterval(state.countdownTimer);

    const cells = { days: $('t-days'), hours: $('t-hours'), minutes: $('t-minutes'), seconds: $('t-seconds') };
    const write = (d, h, m, s) => {
        cells.days.textContent = String(d).padStart(2, '0');
        cells.hours.textContent = String(h).padStart(2, '0');
        cells.minutes.textContent = String(m).padStart(2, '0');
        cells.seconds.textContent = String(s).padStart(2, '0');
    };

    const target = parseDate(isoDate);
    if (!target) {
        write('--', '--', '--', '--');
        $('countdown-label').textContent = 'Contagem regressiva';
        $('countdown-date').textContent = can.editWedding()
            ? 'Cadastre a data em Configurações.'
            : 'Data ainda não definida.';
        return;
    }

    if (ceremonyTime) {
        const [hour, minute] = String(ceremonyTime).split(':').map(Number);
        target.setHours(hour || 0, minute || 0, 0, 0);
    }

    const place = [state.wedding.venue, state.wedding.city].filter(Boolean).join(', ');
    $('countdown-date').textContent = formatLongDate(isoDate)
        + (ceremonyTime ? ` às ${formatTime(ceremonyTime)}` : '')
        + (place ? ` · ${place}` : '');

    const tick = () => {
        const diff = target.getTime() - Date.now();

        if (diff <= 0) {
            write(0, 0, 0, 0);
            $('countdown-label').textContent = 'O grande dia chegou';
            clearInterval(state.countdownTimer);
            return;
        }

        $('countdown-label').textContent = 'Faltam';
        write(
            Math.floor(diff / 86400000),
            Math.floor(diff / 3600000) % 24,
            Math.floor(diff / 60000) % 60,
            Math.floor(diff / 1000) % 60
        );
    };

    tick();
    state.countdownTimer = setInterval(tick, 1000);
}

function statCard({ label, value, note, variant = '' }) {
    return `
        <div class="stat-card ${variant}">
            <span class="stat-label">${escapeHtml(label)}</span>
            <strong class="stat-value">${escapeHtml(value)}</strong>
            ${note ? `<small class="stat-note">${escapeHtml(note)}</small>` : ''}
        </div>`;
}

function renderOverview() {
    const finance = financeSummary();
    const guests = guestTotals();
    const vendors = vendorCounts();
    const doneTasks = state.tasks.filter((t) => t.status === 'done').length;

    $('overview-sub').textContent = can.seeFinance()
        ? 'Onde o dinheiro está e o que vem pela frente.'
        : 'O que já está certo e o que vem pela frente.';

    let cards;
    if (can.seeFinance()) {
        const perGuest = guests.confirmed > 0 ? finance.contracted / guests.confirmed : 0;
        cards = [
            finance.budget > 0
                ? {
                    label: 'Orçamento',
                    value: money(finance.budget),
                    note: finance.remainingBudget >= 0
                        ? `Sobram ${money(finance.remainingBudget)} para contratar`
                        : `Passou ${money(Math.abs(finance.remainingBudget))} do previsto`,
                    variant: finance.remainingBudget >= 0 ? 'accent' : 'bad'
                }
                : { label: 'Orçamento', value: 'Não definido', note: 'Defina em Configurações' },
            { label: 'Total contratado', value: money(finance.contracted), note: `${vendors.total} fornecedor(es)` },
            { label: 'Já pago', value: money(finance.paid), variant: 'good' },
            {
                label: 'Falta pagar',
                value: money(finance.pending),
                note: finance.overdue > 0 ? `${money(finance.overdue)} em atraso` : 'Nada em atraso',
                variant: finance.overdue > 0 ? 'bad' : ''
            },
            { label: 'Confirmados', value: String(guests.confirmed), note: `${guests.total} convidados no total` },
            {
                label: 'Custo por confirmado',
                value: guests.confirmed > 0 ? money(perGuest) : '—',
                note: guests.confirmed > 0 ? 'Contratado ÷ confirmados' : 'Confirme convidados'
            }
        ];
    } else {
        cards = [
            { label: 'Convidados', value: String(guests.total), note: `${guests.adults} adultos · ${guests.children} crianças`, variant: 'accent' },
            { label: 'Confirmados', value: String(guests.confirmed), note: `${guests.pending} sem resposta`, variant: 'good' },
            {
                label: 'Convites a enviar',
                value: String(guests.toInvite),
                note: `${guests.invitesSent} de ${guests.invitations} enviados`,
                variant: guests.toInvite > 0 ? 'bad' : ''
            },
            {
                label: 'Fornecedores urgentes',
                value: String(vendors.urgent),
                note: `${vendors.pending} com algo a acertar`,
                variant: vendors.urgent > 0 ? 'bad' : ''
            },
            { label: 'Fornecedores certos', value: `${vendors.ok}/${vendors.total}`, variant: 'good' },
            { label: 'Checklist', value: `${doneTasks}/${state.tasks.length}`, note: 'tarefas concluídas' }
        ];
    }

    $('overview-stats').innerHTML = cards.map(statCard).join('');

    // Urgentes e com algo a acertar. Quem está sendo pago já está encaminhado.
    const attention = sortedVendors(state.vendors.filter((v) => v.status === 'urgent' || v.status === 'pending')).slice(0, 6);
    $('overview-vendors').innerHTML = attention.length
        ? attention.map((vendor) => {
            const status = VENDOR_STATUS[vendor.status] ?? VENDOR_STATUS.pending;
            const detail = vendor.next_step || CATEGORY_LABELS[vendor.category] || '';
            return `
                <div class="upcoming-row">
                    <div>
                        <strong>${escapeHtml(vendor.name)}</strong>
                        <small>${escapeHtml(detail)}</small>
                    </div>
                    <span class="badge ${status.badge}">${status.label}</span>
                </div>`;
        }).join('')
        : `<p class="empty-state">${vendors.total
            ? 'Nenhum fornecedor precisa de atenção agora.'
            : 'Nenhum fornecedor cadastrado ainda.'}</p>`;

    // Próximos pagamentos: com valor para o casal, sem valor para a cerimonialista.
    if (!can.seeFinance()) {
        const vendorName = (vendorId) => state.vendors.find((v) => v.id === vendorId)?.name ?? 'Fornecedor';
        const upcoming = state.paymentStatus.filter((p) => !p.is_paid && p.due_date).slice(0, 6);

        $('upcoming-payments').innerHTML = upcoming.length
            ? upcoming.map((payment) => {
                const overdue = isOverdue(payment);
                return `
                    <div class="upcoming-row">
                        <div>
                            <strong>${escapeHtml(vendorName(payment.vendor_id))}</strong>
                            <small>${escapeHtml(payment.description)} · ${formatDate(payment.due_date)}</small>
                        </div>
                        <span class="badge ${overdue ? 'danger' : 'neutral'}">${overdue ? 'Atrasado' : 'A vencer'}</span>
                    </div>`;
            }).join('')
            : '<p class="empty-state">Nenhum pagamento em aberto.</p>';
    } else {
        const upcoming = allPayments()
            .filter((p) => !p.is_paid && p.due_date)
            .sort((a, b) => a.due_date.localeCompare(b.due_date))
            .slice(0, 6);

        $('upcoming-payments').innerHTML = upcoming.length
            ? upcoming.map((payment) => {
                const overdue = isOverdue(payment);
                return `
                    <div class="upcoming-row">
                        <div>
                            <strong>${escapeHtml(payment.vendorName)}</strong>
                            <small>${escapeHtml(payment.description)} · ${formatDate(payment.due_date)}</small>
                        </div>
                        <div style="text-align:right;">
                            <strong class="money">${money(payment.amount)}</strong><br>
                            <span class="badge ${overdue ? 'danger' : 'neutral'}">
                                ${overdue ? 'Atrasado' : 'A vencer'}
                            </span>
                        </div>
                    </div>`;
            }).join('')
            : '<p class="empty-state">Nenhum pagamento em aberto.</p>';
    }

    // Barras de progresso
    const percent = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);

    const paidCount = state.paymentStatus.filter((p) => p.is_paid).length;

    $('overview-progress').innerHTML = [
        can.seeFinance()
            ? meter('Pagamentos quitados', `${Math.round(percent(finance.paid, finance.scheduled))}%`,
                percent(finance.paid, finance.scheduled))
            : meter('Parcelas pagas', `${paidCount}/${state.paymentStatus.length}`,
                percent(paidCount, state.paymentStatus.length)),
        meter('Fornecedores certos', `${vendors.ok}/${vendors.total}`, percent(vendors.ok, vendors.total)),
        meter('Convites enviados', `${guests.invitesSent}/${guests.invitations}`,
            percent(guests.invitesSent, guests.invitations)),
        meter('Confirmações', `${guests.confirmed}/${guests.total}`, percent(guests.confirmed, guests.total)),
        meter('Checklist', `${doneTasks}/${state.tasks.length}`, percent(doneTasks, state.tasks.length)),
        can.seeFinance() && finance.budget > 0
            ? meter('Orçamento comprometido',
                `${Math.round(percent(finance.contracted, finance.budget))}%`,
                percent(finance.contracted, finance.budget),
                finance.contracted > finance.budget)
            : ''
    ].join('');
}

function meter(label, value, percent, danger = false) {
    const width = Math.max(0, Math.min(100, percent || 0));
    return `
        <div class="meter">
            <div class="meter-head"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
            <div class="progress-track">
                <div class="progress-fill ${!danger && width >= 100 ? 'done' : ''}"
                     style="width:${width}%; ${danger ? 'background:var(--danger);' : ''}"></div>
            </div>
        </div>`;
}

// ---------- Fornecedores (ficha, um por um) ----------

function renderVendorDirectory() {
    const counts = vendorCounts();

    $('vendor-stats').innerHTML = [
        { label: 'Fornecedores', value: String(counts.total), variant: 'accent' },
        { label: 'Tudo certo', value: String(counts.ok), variant: 'good' },
        { label: 'Estamos pagando', value: String(counts.paying) },
        { label: 'Falta acertar', value: String(counts.pending) },
        {
            label: 'Urgentes',
            value: String(counts.urgent),
            variant: counts.urgent > 0 ? 'bad' : '',
            note: counts.urgent > 0 ? 'Resolver primeiro' : 'Nada urgente'
        }
    ].map(statCard).join('');

    syncFilterChips('vendor-filters', state.vendorFilter);

    const visible = sortedVendors(state.vendors.filter((vendor) =>
        state.vendorFilter === 'all' || vendor.status === state.vendorFilter));

    $('vendor-directory').innerHTML = visible.length
        ? visible.map(renderVendorRow).join('')
        : `<p class="empty-state">${state.vendors.length
            ? 'Nenhum fornecedor neste filtro.'
            : 'Nenhum fornecedor cadastrado ainda. Use o formulário acima.'}</p>`;
}

function renderVendorRow(vendor) {
    const status = VENDOR_STATUS[vendor.status] ?? VENDOR_STATUS.pending;
    const details = [
        CATEGORY_LABELS[vendor.category] ?? vendor.category,
        vendor.contact_name ? `falar com ${vendor.contact_name}` : null,
        vendor.arrival_time ? `chega às ${formatTime(vendor.arrival_time)}` : null
    ].filter(Boolean).join(' · ');

    const links = [];
    if (vendor.phone) {
        links.push(`<a href="tel:${escapeHtml(vendor.phone.replace(/[^\d+]/g, ''))}">${escapeHtml(vendor.phone)}</a>`);
        const wa = whatsappNumber(vendor.phone);
        if (wa) links.push(`<a href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>`);
    }
    if (vendor.email) {
        links.push(`<a href="mailto:${escapeHtml(vendor.email)}">${escapeHtml(vendor.email)}</a>`);
    }

    return `
        <div class="row-card ${status.row}">
            <div class="row-main">
                <strong>${escapeHtml(vendor.name)}</strong>
                <small>${escapeHtml(details)}</small>
                ${vendor.next_step ? `<p class="row-note">⚑ ${escapeHtml(vendor.next_step)}</p>` : ''}
                ${vendor.notes ? `<p class="row-note muted">${escapeHtml(vendor.notes)}</p>` : ''}
                ${links.length ? `<div class="contact-links">${links.join('')}</div>` : ''}
            </div>
            <div class="row-actions">
                <span class="badge ${status.badge}">${status.label}</span>
                <select class="input btn-sm compact-select" data-action="vendor-status" data-id="${vendor.id}"
                        aria-label="Situação de ${escapeHtml(vendor.name)}">
                    ${statusOptions(VENDOR_STATUS, vendor.status)}
                </select>
                <button class="icon-btn edit" data-action="edit-contact" data-id="${vendor.id}" title="Editar">✎</button>
                ${can.editWedding()
            ? `<button class="icon-btn delete" data-action="delete-vendor" data-id="${vendor.id}" title="Excluir">✕</button>`
            : ''}
            </div>
        </div>`;
}

// ---------- Valores ----------

function renderFinance() {
    const finance = financeSummary();

    $('finance-stats').innerHTML = [
        { label: 'Contratado', value: money(finance.contracted), variant: 'accent' },
        { label: 'Pago', value: money(finance.paid), variant: 'good' },
        { label: 'Em aberto', value: money(finance.pending) },
        {
            label: 'Em atraso',
            value: money(finance.overdue),
            variant: finance.overdue > 0 ? 'bad' : '',
            note: finance.overdue > 0 ? 'Resolver com prioridade' : 'Tudo em dia'
        }
    ].map(statCard).join('');

    $('vendors-list').innerHTML = state.vendors.length
        ? state.vendors.map(renderVendorCard).join('')
        : '<p class="empty-state">Nenhum fornecedor cadastrado ainda. Use o formulário acima.</p>';

    renderCashflow();
}

function renderVendorCard(vendor) {
    const totals = vendorTotals(vendor);
    const category = CATEGORY_LABELS[vendor.category] ?? vendor.category;

    // Fornecedor cadastrado só na aba Fornecedores, ainda sem contrato.
    if (!vendor.has_contract && !(vendor.payments ?? []).length) {
        return `
            <article class="vendor-card">
                <header class="vendor-head">
                    <div>
                        <h3 class="vendor-name">${escapeHtml(vendor.name)}</h3>
                        <p class="vendor-meta">${escapeHtml(category)} · sem valores lançados</p>
                    </div>
                    <div class="vendor-actions">
                        <button class="btn btn-sm" data-action="edit-vendor" data-id="${vendor.id}">Lançar valores</button>
                    </div>
                </header>
            </article>`;
    }

    const meta = [category, vendor.payment_method, vendor.contract_notes].filter(Boolean).join(' · ');

    const payments = (vendor.payments ?? []).map((payment) => {
        const overdue = isOverdue(payment);
        const classes = ['payment-row', payment.is_paid ? 'paid' : '', overdue ? 'overdue' : ''].join(' ');
        return `
            <div class="${classes}">
                <div class="payment-main">
                    <input type="checkbox" class="payment-check" ${payment.is_paid ? 'checked' : ''}
                           data-action="toggle-payment" data-id="${payment.id}"
                           aria-label="Marcar ${escapeHtml(payment.description)} como pago">
                    <div class="payment-desc">
                        <strong>${escapeHtml(payment.description)}</strong>
                        <div class="payment-fields">
                            <input type="date" class="cell-input cell-date" value="${payment.due_date ?? ''}"
                                   data-action="payment-date" data-id="${payment.id}"
                                   aria-label="Vencimento de ${escapeHtml(payment.description)}">
                            ${overdue ? '<span class="badge danger">Atrasado</span>' : ''}
                        </div>
                    </div>
                </div>
                <div class="payment-value">
                    <span class="currency-prefix">R$</span>
                    <input type="number" class="cell-input cell-amount" min="0" step="0.01"
                           value="${num(payment.amount).toFixed(2)}"
                           data-action="payment-amount" data-id="${payment.id}"
                           aria-label="Valor de ${escapeHtml(payment.description)}">
                </div>
            </div>`;
    }).join('');

    // Mexer numa parcela pode desencontrar a soma do contrato — avisa em vez de esconder.
    const drift = totals.scheduled - totals.contracted;
    const driftNote = Math.abs(drift) > 0.005
        ? `<p class="schedule-drift">As parcelas somam ${money(totals.scheduled)}, ${drift > 0 ? 'acima' : 'abaixo'}
             do total do contrato (${money(totals.contracted)}). Diferença de ${money(Math.abs(drift))}.</p>`
        : '';

    return `
        <article class="vendor-card ${totals.settled ? 'settled' : ''}">
            <header class="vendor-head">
                <div>
                    <h3 class="vendor-name">${escapeHtml(vendor.name)} ${totals.settled ? '✓' : ''}</h3>
                    ${meta ? `<p class="vendor-meta">${escapeHtml(meta)}</p>` : ''}
                </div>
                <div>
                    <div class="vendor-total">${money(totals.contracted)}</div>
                    <div class="vendor-actions">
                        <button class="icon-btn edit" data-action="edit-vendor" data-id="${vendor.id}"
                                title="Editar">✎</button>
                        <button class="icon-btn delete" data-action="delete-vendor" data-id="${vendor.id}"
                                title="Excluir">✕</button>
                    </div>
                </div>
            </header>

            <div class="vendor-progress">
                <div class="progress-labels">
                    <span>Pago ${money(totals.paid)} de ${money(totals.contracted)}</span>
                    <span>${Math.round(totals.percent)}%</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill ${totals.settled ? 'done' : ''}" style="width:${totals.percent}%"></div>
                </div>
            </div>

            ${payments || '<p class="empty-state">Sem parcelas lançadas.</p>'}
            ${driftNote}
        </article>`;
}

/** Pagamentos para a cerimonialista: parcela por parcela, sem nenhum valor. */
function renderPaymentStatus() {
    const byVendor = new Map();
    for (const payment of state.paymentStatus) {
        if (!byVendor.has(payment.vendor_id)) byVendor.set(payment.vendor_id, []);
        byVendor.get(payment.vendor_id).push(payment);
    }

    const cards = state.vendors
        .filter((vendor) => byVendor.has(vendor.id))
        .map((vendor) => {
            const payments = byVendor.get(vendor.id);
            const settled = payments[0].vendor_settled;
            const overdueCount = payments.filter(isOverdue).length;
            const paidCount = payments.filter((p) => p.is_paid).length;
            // Atrasado primeiro, quitado por último.
            const rank = overdueCount > 0 ? 0 : settled ? 2 : 1;
            return { vendor, payments, settled, overdueCount, paidCount, rank };
        })
        .sort((a, b) => a.rank - b.rank || a.vendor.name.localeCompare(b.vendor.name, 'pt-BR'));

    const withoutPayments = state.vendors.filter((vendor) => !byVendor.has(vendor.id)).map((v) => v.name);

    const html = cards.map(({ vendor, payments, settled, overdueCount, paidCount }) => {
        const badge = settled
            ? '<span class="badge success">Quitado</span>'
            : overdueCount > 0
                ? `<span class="badge danger">${overdueCount} parcela(s) atrasada(s)</span>`
                : '<span class="badge neutral">Em dia</span>';
        const percent = (paidCount / payments.length) * 100;

        const rows = payments.map((payment) => {
            const overdue = isOverdue(payment);
            const classes = ['payment-row', payment.is_paid ? 'paid' : '', overdue ? 'overdue' : ''].join(' ');
            const status = payment.is_paid
                ? '<span class="badge success">Pago</span>'
                : overdue ? '<span class="badge danger">Atrasado</span>' : '<span class="badge neutral">A vencer</span>';
            return `
                <div class="${classes}">
                    <div class="payment-desc">
                        <strong>${escapeHtml(payment.description)}</strong>
                        <small>Vence em ${formatDate(payment.due_date)}</small>
                    </div>
                    ${status}
                </div>`;
        }).join('');

        return `
            <article class="vendor-card ${settled ? 'settled' : ''}">
                <header class="vendor-head">
                    <div>
                        <h3 class="vendor-name">${escapeHtml(vendor.name)} ${settled ? '✓' : ''}</h3>
                        <p class="vendor-meta">${escapeHtml(CATEGORY_LABELS[vendor.category] ?? vendor.category)}</p>
                    </div>
                    <div>${badge}</div>
                </header>
                <div class="vendor-progress">
                    <div class="progress-labels">
                        <span>${paidCount} de ${payments.length} parcela(s) paga(s)</span>
                        <span>${Math.round(percent)}%</span>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill ${settled ? 'done' : ''}" style="width:${percent}%"></div>
                    </div>
                </div>
                ${rows}
            </article>`;
    }).join('');

    $('payment-status').innerHTML = (html || '<p class="empty-state">Nenhum pagamento lançado ainda.</p>')
        + (withoutPayments.length
            ? `<p class="form-hint">Sem pagamentos lançados: ${escapeHtml(withoutPayments.join(', '))}.</p>`
            : '');
}

function renderCashflow() {
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const months = new Map();

    for (const payment of allPayments()) {
        if (!payment.due_date) continue;
        const key = payment.due_date.slice(0, 7);

        if (!months.has(key)) {
            const [year, month] = key.split('-');
            months.set(key, {
                label: `${monthNames[Number(month) - 1]} ${year}`,
                total: 0, paid: 0, pending: 0, items: []
            });
        }

        const bucket = months.get(key);
        const amount = num(payment.amount);
        bucket.total += amount;
        if (payment.is_paid) bucket.paid += amount;
        else bucket.pending += amount;
        bucket.items.push(payment);
    }

    const keys = [...months.keys()].sort();
    const container = $('cashflow');

    if (!keys.length) {
        container.innerHTML = '<p class="empty-state">Nenhum pagamento programado ainda.</p>';
        return;
    }

    container.innerHTML = keys.map((key) => {
        const month = months.get(key);
        const percent = month.total > 0 ? (month.paid / month.total) * 100 : 0;
        const settled = month.pending <= 0.005 && month.total > 0;

        const items = month.items
            .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
            .map((item) => `
                <div class="month-item">
                    <span style="${item.is_paid ? 'opacity:.55;text-decoration:line-through;' : ''}">
                        ${escapeHtml(item.vendorName)} · ${escapeHtml(item.description)}
                    </span>
                    <strong class="money" style="color:${item.is_paid ? 'var(--success)' : 'var(--text)'}">
                        ${money(item.amount)}
                    </strong>
                </div>`).join('');

        return `
            <div class="month-card ${settled ? 'settled' : ''}">
                <h4>${escapeHtml(month.label)} ${settled ? '✓' : ''}</h4>
                <div class="month-line"><span>Total</span><strong>${money(month.total)}</strong></div>
                <div class="month-line">
                    <span>Falta</span>
                    <strong style="color:${settled ? 'var(--success)' : 'var(--danger)'}">${money(month.pending)}</strong>
                </div>
                <div class="progress-track" style="height:4px;margin-top:6px;">
                    <div class="progress-fill ${settled ? 'done' : ''}" style="width:${percent}%"></div>
                </div>
                <div class="month-items">${items}</div>
            </div>`;
    }).join('');
}

// ---------- Convidados ----------

function guestMatchesFilter(guest) {
    switch (state.guestFilter) {
        case 'to-invite': return !guest.invite_sent && guest.status !== 'declined';
        case 'pending':
        case 'confirmed':
        case 'declined': return guest.status === state.guestFilter;
        default: return true;
    }
}

function renderGuests() {
    const totals = guestTotals();

    $('guest-stats').innerHTML = [
        { label: 'Total de pessoas', value: String(totals.total), variant: 'accent' },
        { label: 'Confirmados', value: String(totals.confirmed), variant: 'good' },
        { label: 'Pendentes', value: String(totals.pending) },
        { label: 'Adultos / crianças', value: `${totals.adults} / ${totals.children}` },
        {
            label: 'Convites a enviar',
            value: String(totals.toInvite),
            note: `${totals.invitesSent} de ${totals.invitations} enviados`,
            variant: totals.toInvite > 0 ? 'bad' : ''
        }
    ].map(statCard).join('');

    syncFilterChips('guest-filters', state.guestFilter);

    const groomsmen = [];
    const others = [];

    for (const guest of state.guests) {
        if (!guestMatchesFilter(guest)) continue;
        (guest.group_name === 'Padrinhos' ? groomsmen : others).push(renderGuestRow(guest));
    }

    const empty = (what) => (state.guestFilter === 'all'
        ? `<p class="empty-state">Nenhum ${what} cadastrado.</p>`
        : '<p class="empty-state">Ninguém neste filtro.</p>');

    $('padrinhos-list').innerHTML = groomsmen.length ? groomsmen.join('') : empty('padrinho');
    $('guests-list').innerHTML = others.length ? others.join('') : empty('convidado');

    renderDrinks();
}

function renderGuestRow(guest) {
    const status = GUEST_STATUS[guest.status] ?? GUEST_STATUS.pending;
    const details = [
        guest.group_name,
        `${num(guest.adults)} adulto(s)`,
        num(guest.children) > 0 ? `${num(guest.children)} criança(s)` : null,
        guest.phone
    ].filter(Boolean).join(' · ');

    const inviteButton = guest.invite_sent
        ? `<button class="btn btn-sm invite-toggle sent" data-action="toggle-invite" data-id="${guest.id}"
                   title="Clique para desmarcar">✉ Convite enviado</button>`
        : `<button class="btn btn-sm invite-toggle" data-action="toggle-invite" data-id="${guest.id}"
                   title="Marcar que o convite já foi entregue">Marcar convite enviado</button>`;

    return `
        <div class="row-card ${guest.status}">
            <div class="row-main">
                <strong>${escapeHtml(guest.name)}</strong>
                <small>${escapeHtml(details)}</small>
            </div>
            <div class="row-actions">
                ${inviteButton}
                <span class="badge ${status.badge}">${status.label}</span>
                <select class="input btn-sm compact-select"
                        data-action="guest-status" data-id="${guest.id}" aria-label="Status de ${escapeHtml(guest.name)}">
                    ${statusOptions(GUEST_STATUS, guest.status)}
                </select>
                <button class="icon-btn edit" data-action="edit-guest" data-id="${guest.id}" title="Editar">✎</button>
                <button class="icon-btn delete" data-action="delete-guest" data-id="${guest.id}" title="Excluir">✕</button>
            </div>
        </div>`;
}

function renderDrinks() {
    const totals = { beer: 0, soda: 0, juice: 0, water: 0, cocktail: 0 };

    for (const guest of state.guests) {
        if (guest.status !== 'confirmed') continue;
        const drinks = guest.beverages ?? {};
        totals.beer += num(drinks.beer) * DRINK_RATIOS.beer;
        totals.soda += num(drinks.soda) * DRINK_RATIOS.soda;
        totals.juice += num(drinks.juice) * DRINK_RATIOS.juice;
        totals.water += num(drinks.water) * DRINK_RATIOS.water;
        totals.cocktail += num(drinks.cocktail);
    }

    $('drinks-summary').innerHTML = [
        { label: '🍺 Cerveja', value: `${Math.ceil(totals.beer)} L` },
        { label: '🥤 Refrigerante', value: `${Math.ceil(totals.soda)} L` },
        { label: '🧃 Suco', value: `${Math.ceil(totals.juice)} L` },
        { label: '💧 Água', value: `${Math.ceil(totals.water)} L` },
        { label: '🍸 Drinks', value: `${totals.cocktail} pessoa(s)` }
    ].map(statCard).join('');
}

function syncFilterChips(containerId, active) {
    $(containerId).querySelectorAll('[data-filter]').forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.filter === active);
    });
}

// ---------- Checklist e roteiro ----------

function renderChecklist() {
    const done = state.tasks.filter((task) => task.status === 'done').length;
    const percent = state.tasks.length ? Math.round((done / state.tasks.length) * 100) : 0;

    $('checklist-percent').textContent = `${percent}%`;
    $('checklist-bar').style.width = `${percent}%`;
    $('checklist-bar').className = `progress-fill ${percent >= 100 ? 'done' : ''}`;

    $('checklist-list').innerHTML = state.tasks.length
        ? state.tasks.map((task) => {
            const status = TASK_STATUS[task.status] ?? TASK_STATUS.pending;
            const overdue = task.status !== 'done' && task.due_date && task.due_date < todayIso();

            return `
                <div class="row-card ${task.status}">
                    <div class="row-main">
                        <strong>${escapeHtml(task.title)}</strong>
                        ${task.due_date
                    ? `<small>Prazo: ${formatDate(task.due_date)}${overdue ? ' · vencido' : ''}</small>`
                    : ''}
                    </div>
                    <div class="row-actions">
                        <span class="badge ${overdue ? 'danger' : status.badge}">
                            ${overdue ? 'Vencido' : status.label}
                        </span>
                        <select class="input btn-sm compact-select"
                                data-action="task-status" data-id="${task.id}"
                                aria-label="Status de ${escapeHtml(task.title)}">${statusOptions(TASK_STATUS, task.status)}</select>
                        <button class="icon-btn delete" data-action="delete-task" data-id="${task.id}"
                                title="Excluir">✕</button>
                    </div>
                </div>`;
        }).join('')
        : '<p class="empty-state">Checklist vazio. Adicione a primeira tarefa acima.</p>';
}

function renderRunOfShow() {
    $('ros-timeline').innerHTML = state.runOfShow.length
        ? state.runOfShow.map((item) => `
            <div class="timeline-row">
                <div class="timeline-time">${formatTime(item.event_time)}</div>
                <div class="timeline-dot"></div>
                <div class="timeline-body">
                    <strong>${escapeHtml(item.title)}</strong>
                    <span class="badge neutral" style="margin-top:6px;">${ROS_ROLE[item.role] ?? ''}</span>
                    <button class="icon-btn delete" style="float:right;" data-action="delete-ros"
                            data-id="${item.id}" title="Excluir">✕</button>
                </div>
            </div>`).join('')
        : '<p class="empty-state">Nenhum momento no roteiro ainda.</p>';

    const arrivals = state.vendors
        .filter((vendor) => vendor.arrival_time)
        .sort((a, b) => String(a.arrival_time).localeCompare(String(b.arrival_time)));

    $('vendor-arrivals').innerHTML = arrivals.length
        ? arrivals.map((vendor) => {
            const status = VENDOR_STATUS[vendor.status] ?? VENDOR_STATUS.pending;
            const detail = [CATEGORY_LABELS[vendor.category], vendor.contact_name, vendor.phone]
                .filter(Boolean).join(' · ');
            return `
                <div class="upcoming-row">
                    <div>
                        <strong>${formatTime(vendor.arrival_time)} · ${escapeHtml(vendor.name)}</strong>
                        <small>${escapeHtml(detail)}</small>
                    </div>
                    <span class="badge ${status.badge}">${status.label}</span>
                </div>`;
        }).join('')
        : '<p class="empty-state">Nenhum horário de chegada definido ainda.</p>';
}

// ---------- Configurações ----------

function setIfIdle(id, value) {
    const element = $(id);
    if (element && document.activeElement !== element) element.value = value ?? '';
}

function renderSettings() {
    const wedding = state.wedding;

    setIfIdle('w-partner1', wedding.partner1_name);
    setIfIdle('w-partner2', wedding.partner2_name);
    setIfIdle('w-date', wedding.wedding_date);
    setIfIdle('w-time', formatTime(wedding.ceremony_time));
    setIfIdle('w-budget', state.private?.estimated_budget);
    setIfIdle('w-venue', wedding.venue);
    setIfIdle('w-city', wedding.city);
    setIfIdle('w-cover', wedding.cover_image_url);

    const manage = can.manageMembers();

    $('members-list').innerHTML = state.members.map((member) => {
        const accepted = member.invite_status === 'accepted';
        const isMe = member.user_id === state.userId;
        const name = isMe ? 'Você' : member.display_name || member.invited_email || 'Membro';
        const roleLabel = ROLE_LABELS[member.role] ?? member.role;
        const editableRole = manage && member.role !== 'owner';

        const roleControl = editableRole
            ? `<select class="input btn-sm compact-select" data-action="member-role" data-id="${member.id}"
                       aria-label="Acesso de ${escapeHtml(name)}">
                   <option value="editor" ${member.role === 'editor' ? 'selected' : ''}>Acesso total</option>
                   <option value="planner" ${member.role === 'planner' ? 'selected' : ''}>Cerimonialista</option>
               </select>`
            : '';

        return `
            <div class="row-card ${accepted ? 'confirmed' : 'pending'}">
                <div class="row-main">
                    <strong>${escapeHtml(name)}</strong>
                    <small>${roleLabel}${member.invited_email && !isMe ? ` · ${escapeHtml(member.invited_email)}` : ''}${accepted ? '' : ` · código: ${escapeHtml(member.invite_token)}`}</small>
                </div>
                <div class="row-actions">
                    <span class="badge ${accepted ? 'success' : 'warning'}">
                        ${accepted ? 'Ativo' : 'Aguardando a pessoa entrar'}
                    </span>
                    ${roleControl}
                    ${accepted || !can.editWedding() ? '' : `<button class="btn btn-sm" data-action="copy-invite"
                        data-token="${escapeHtml(member.invite_token)}">Copiar código</button>`}
                    ${editableRole ? `<button class="icon-btn delete" data-action="remove-member"
                        data-id="${member.id}" title="Remover acesso">✕</button>` : ''}
                </div>
            </div>`;
    }).join('') || '<p class="empty-state">Só você tem acesso.</p>';
}

// ==========================================================
// Eventos
// ==========================================================

function showTab(target) {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.target === target));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === target));
}

function wireEvents() {
    // Navegação
    document.querySelectorAll('.nav-btn[data-target]').forEach((button) => {
        button.addEventListener('click', () => {
            showTab(button.dataset.target);
            closeMenu();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    $('btn-menu').addEventListener('click', () => {
        const isOpen = $('sidebar').classList.toggle('open');
        $('scrim').hidden = !isOpen;
        $('btn-menu').setAttribute('aria-expanded', String(isOpen));
    });
    $('scrim').addEventListener('click', closeMenu);

    $('btn-logout').addEventListener('click', async () => {
        state.unsubscribe?.();
        await db.signOut();
        window.location.replace('index.html');
    });

    fillCategorySelects();
    wireContactForm();
    wireVendorForm();
    wireGuestForm();
    wireChecklist();
    wireRunOfShow();
    wireSettings();

    // Ações delegadas (funcionam mesmo depois de redesenhar as listas)
    document.addEventListener('click', onDelegatedClick);
    document.addEventListener('change', onDelegatedChange);

    $('btn-export-finance').addEventListener('click', (event) =>
        exportFinancePdf(event.currentTarget, state, { financeSummary, vendorTotals, allPayments }));
    $('btn-export-guests').addEventListener('click', (event) =>
        exportGuestsPdf(event.currentTarget, state, { guestTotals }));
    $('btn-export-vendors').addEventListener('click', (event) =>
        exportVendorsPdf(event.currentTarget, state, {
            sortedVendors, vendorCounts, categoryLabels: CATEGORY_LABELS, statusLabels: VENDOR_STATUS
        }));
}

function fillCategorySelects() {
    const options = Object.entries(CATEGORY_LABELS)
        .map(([value, label]) => `<option value="${value}" ${value === 'other' ? 'selected' : ''}>${label}</option>`)
        .join('');
    document.querySelectorAll('select[data-categories]').forEach((select) => { select.innerHTML = options; });
}

function closeMenu() {
    $('sidebar').classList.remove('open');
    $('scrim').hidden = true;
    $('btn-menu').setAttribute('aria-expanded', 'false');
}

async function onDelegatedClick(event) {
    const chip = event.target.closest('[data-filter]');
    if (chip) {
        const group = chip.closest('.filter-row')?.id;
        if (group === 'vendor-filters') {
            state.vendorFilter = chip.dataset.filter;
            renderVendorDirectory();
        } else if (group === 'guest-filters') {
            state.guestFilter = chip.dataset.filter;
            renderGuests();
        }
        return;
    }

    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;
    const { action, id, token } = trigger.dataset;

    if (action === 'edit-vendor') return startVendorEdit(id);
    if (action === 'edit-contact') return startContactEdit(id);
    if (action === 'edit-guest') return startGuestEdit(id);

    if (action === 'delete-vendor') {
        const vendor = state.vendors.find((v) => v.id === id);
        if (!confirm(`Excluir "${vendor?.name}"? Some da lista de fornecedores e leva junto os valores e as parcelas.`)) return;
        return mutate(() => db.deleteVendor(id), 'Fornecedor excluído.');
    }

    if (action === 'delete-guest') {
        const guest = state.guests.find((g) => g.id === id);
        if (!confirm(`Remover "${guest?.name}" da lista?`)) return;
        return mutate(() => db.deleteGuest(id), 'Convidado removido.');
    }

    if (action === 'toggle-invite') {
        const guest = state.guests.find((g) => g.id === id);
        if (!guest) return;
        return mutate(() => db.updateGuest(id, { invite_sent: !guest.invite_sent }));
    }

    if (action === 'delete-task') return mutate(() => db.deleteTask(id));
    if (action === 'delete-ros') {
        if (!confirm('Excluir este momento do roteiro?')) return;
        return mutate(() => db.deleteRunOfShowItem(id));
    }

    if (action === 'remove-member') {
        if (!confirm('Remover o acesso desta pessoa?')) return;
        return mutate(() => db.removeMember(id), 'Acesso removido.');
    }

    if (action === 'copy-invite') {
        try {
            await navigator.clipboard.writeText(token);
            toast('Código copiado.', 'success');
        } catch {
            prompt('Copie o código do convite:', token);
        }
    }
}

async function onDelegatedChange(event) {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;
    const { action, id } = trigger.dataset;

    if (action === 'toggle-payment') {
        return mutate(() => db.setPaymentPaid(id, trigger.checked));
    }
    if (action === 'payment-date') {
        return mutate(() => db.updatePayment(id, { due_date: trigger.value || null }));
    }
    if (action === 'payment-amount') {
        const amount = num(trigger.value);
        if (amount < 0) return toast('O valor não pode ser negativo.', 'error');
        return mutate(() => db.updatePayment(id, { amount: round2(amount) }));
    }
    if (action === 'vendor-status') {
        return mutate(() => db.updateVendor(id, { status: trigger.value }));
    }
    if (action === 'guest-status') {
        return mutate(() => db.updateGuest(id, { status: trigger.value }));
    }
    if (action === 'task-status') {
        return mutate(() => db.updateTask(id, { status: trigger.value }));
    }
    if (action === 'member-role') {
        return mutate(() => db.updateMemberRole(id, trigger.value), 'Acesso atualizado.');
    }
}

// ---------- Fornecedores: ficha ----------

function wireContactForm() {
    $('contact-form').addEventListener('submit', async (event) => {
        event.preventDefault();

        const vendor = {
            name: $('c-name').value.trim(),
            category: $('c-category').value,
            status: $('c-status').value,
            contact_name: $('c-contact').value.trim() || null,
            phone: $('c-phone').value.trim() || null,
            email: $('c-email').value.trim() || null,
            next_step: $('c-next').value.trim() || null,
            arrival_time: $('c-arrival').value || null,
            notes: $('c-notes').value.trim() || null
        };

        if (!vendor.name) return toast('Informe o nome do fornecedor.', 'error');

        const editingId = state.editingContactId;
        const saved = await mutate(
            () => editingId
                ? db.updateVendor(editingId, vendor)
                : db.createVendor(state.wedding.id, { ...vendor, position: state.vendors.length }),
            editingId ? 'Fornecedor atualizado.' : 'Fornecedor adicionado.'
        );

        if (saved) resetContactForm();
    });

    $('btn-cancel-contact').addEventListener('click', resetContactForm);
}

function startContactEdit(vendorId) {
    const vendor = state.vendors.find((v) => v.id === vendorId);
    if (!vendor) return;

    state.editingContactId = vendorId;
    $('c-name').value = vendor.name;
    $('c-category').value = vendor.category ?? 'other';
    $('c-status').value = vendor.status ?? 'pending';
    $('c-contact').value = vendor.contact_name ?? '';
    $('c-phone').value = vendor.phone ?? '';
    $('c-email').value = vendor.email ?? '';
    $('c-next').value = vendor.next_step ?? '';
    $('c-arrival').value = formatTime(vendor.arrival_time);
    $('c-notes').value = vendor.notes ?? '';

    $('contact-form-title').textContent = `Editando ${vendor.name}`;
    $('btn-submit-contact').textContent = 'Atualizar';
    $('btn-cancel-contact').hidden = false;
    $('contact-form').scrollIntoView({ behavior: 'smooth' });
}

function resetContactForm() {
    state.editingContactId = null;
    $('contact-form').reset();
    $('c-category').value = 'other';
    $('contact-form-title').textContent = 'Adicionar fornecedor';
    $('btn-submit-contact').textContent = 'Adicionar';
    $('btn-cancel-contact').hidden = true;
}

// ---------- Fornecedores: valores ----------

/** Monta o carnê: entrada (se houver) + parcelas mensais do restante. */
function buildPayments({ total, entry, installments, firstDate }) {
    const payments = [];

    if (entry > 0) {
        payments.push({ description: 'Entrada', amount: round2(entry), dueDate: firstDate });
    }

    const remaining = total - entry;
    if (installments > 0 && remaining > 0.005) {
        const base = round2(remaining / installments);
        for (let i = 1; i <= installments; i += 1) {
            // A última parcela absorve a sobra dos centavos do arredondamento.
            const amount = i === installments
                ? round2(remaining - base * (installments - 1))
                : base;
            payments.push({
                description: `Parcela ${i}/${installments}`,
                amount,
                dueDate: addMonths(firstDate, entry > 0 ? i : i - 1)
            });
        }
    }

    return payments;
}

function round2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Os campos que definem o carnê. Comparamos ESTES valores — e não o carnê
 * gerado a partir deles — porque as parcelas podem ter sido ajustadas à mão
 * depois; regerar por causa dessa diferença apagaria os ajustes.
 */
function scheduleInputs() {
    return JSON.stringify([
        num($('v-total').value),
        num($('v-entry').value),
        parseInt($('v-installments').value, 10) || 0,
        $('v-date').value
    ]);
}

function readVendorForm() {
    const total = num($('v-total').value);
    const entry = num($('v-entry').value);
    const installments = parseInt($('v-installments').value, 10) || 0;
    const firstDate = $('v-date').value;

    return {
        vendor: {
            name: $('v-name').value.trim(),
            category: $('v-category').value
        },
        contract: {
            total_amount: total,
            payment_method: $('v-method').value.trim() || null,
            notes: $('v-notes').value.trim() || null
        },
        payments: buildPayments({ total, entry, installments, firstDate }),
        total,
        entry
    };
}

function wireVendorForm() {
    const form = $('vendor-form');
    const hint = $('vendor-form-hint');

    const updateHint = () => {
        const total = num($('v-total').value);
        const entry = num($('v-entry').value);
        const installments = parseInt($('v-installments').value, 10) || 0;

        if (total <= 0) return (hint.textContent = '');
        if (entry > total) return (hint.textContent = '⚠ A entrada é maior que o valor total.');

        const remaining = total - entry;
        hint.textContent = installments > 0 && remaining > 0
            ? `${installments}× de ${money(remaining / installments)}${entry > 0 ? ` após entrada de ${money(entry)}` : ''}.`
            : entry > 0 ? `Pagamento único de ${money(entry)}.` : '';
    };

    ['v-total', 'v-entry', 'v-installments'].forEach((id) =>
        $(id).addEventListener('input', updateHint));

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const { vendor, contract, payments, total, entry } = readVendorForm();

        if (!vendor.name) return toast('Informe o nome do fornecedor.', 'error');
        if (total <= 0) return toast('Informe um valor total maior que zero.', 'error');
        if (entry > total) return toast('A entrada não pode passar do valor total.', 'error');
        if (!payments.length) return toast('Defina a entrada ou o número de parcelas.', 'error');

        const editingId = state.editingVendorId;

        // Regerar o carnê apaga e recria as parcelas. Só faz isso se o
        // parcelamento em si mudou; ajustes manuais de data e valor ficam de pé.
        const scheduleChanged = scheduleInputs() !== state.editingVendorInputs;

        const saved = await mutate(
            () => editingId
                ? db.updateVendor(editingId, vendor, contract, scheduleChanged ? payments : null)
                : db.createVendor(state.wedding.id, { ...vendor, position: state.vendors.length }, contract, payments),
            editingId ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.'
        );

        if (saved) resetVendorForm();
    });

    $('btn-cancel-vendor').addEventListener('click', resetVendorForm);
}

function startVendorEdit(vendorId) {
    const vendor = state.vendors.find((v) => v.id === vendorId);
    if (!vendor) return;

    state.editingVendorId = vendorId;
    const payments = vendor.payments ?? [];
    const entryPayment = payments.find((p) => p.description === 'Entrada');
    const installments = payments.filter((p) => p !== entryPayment);

    $('v-name').value = vendor.name;
    $('v-category').value = vendor.category ?? 'other';
    $('v-method').value = vendor.payment_method ?? '';
    $('v-total').value = vendor.has_contract ? vendor.total_amount : '';
    $('v-notes').value = vendor.contract_notes ?? '';
    $('v-entry').value = entryPayment ? entryPayment.amount : '';
    $('v-installments').value = vendor.has_contract ? installments.length : 1;
    $('v-date').value = payments[0]?.due_date ?? '';

    // Guarda o estado inicial dos campos: se nenhum deles mudar, o carnê
    // fica intacto, preservando datas e valores ajustados na mão.
    state.editingVendorInputs = scheduleInputs();

    $('vendor-form-title').textContent = vendor.has_contract
        ? `Editando ${vendor.name}`
        : `Lançando valores de ${vendor.name}`;
    $('btn-submit-vendor').textContent = 'Atualizar';
    $('btn-cancel-vendor').hidden = false;
    $('vendor-form-hint').textContent = vendor.has_contract
        ? 'Mexer em valor total, entrada, nº de parcelas ou 1º vencimento recria o carnê inteiro. '
        + 'Para ajustar só uma parcela, edite direto na lista abaixo.'
        : '';

    $('finance').scrollIntoView({ behavior: 'smooth' });
}

function resetVendorForm() {
    state.editingVendorId = null;
    state.editingVendorInputs = null;
    $('vendor-form').reset();
    $('v-category').value = 'other';
    $('v-installments').value = 1;
    $('vendor-form-title').textContent = 'Lançar contrato';
    $('btn-submit-vendor').textContent = 'Salvar fornecedor';
    $('btn-cancel-vendor').hidden = true;
    $('vendor-form-hint').textContent = '';
}

// ---------- Convidados ----------

function wireGuestForm() {
    const form = $('guest-form');

    $('g-group').addEventListener('change', (event) => {
        if (event.target.value === 'Padrinhos') $('g-adults').value = 2;
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const guest = {
            name: $('g-name').value.trim(),
            phone: $('g-phone').value.trim() || null,
            group_name: $('g-group').value,
            adults: parseInt($('g-adults').value, 10) || 0,
            children: parseInt($('g-children').value, 10) || 0,
            status: $('g-status').value,
            invite_sent: $('g-invite-sent').checked,
            beverages: {
                beer: parseInt($('drink-beer').value, 10) || 0,
                cocktail: parseInt($('drink-cocktail').value, 10) || 0,
                soda: parseInt($('drink-soda').value, 10) || 0,
                juice: parseInt($('drink-juice').value, 10) || 0,
                water: parseInt($('drink-water').value, 10) || 0
            }
        };

        if (!guest.name) return toast('Informe o nome.', 'error');
        if (guest.adults + guest.children < 1) return toast('Informe ao menos uma pessoa.', 'error');

        const editingId = state.editingGuestId;
        const saved = await mutate(
            () => editingId
                ? db.updateGuest(editingId, guest)
                : db.createGuest(state.wedding.id, guest),
            editingId ? 'Convidado atualizado.' : 'Convidado adicionado.'
        );

        if (saved) resetGuestForm();
    });

    $('btn-cancel-guest').addEventListener('click', resetGuestForm);
}

function startGuestEdit(guestId) {
    const guest = state.guests.find((g) => g.id === guestId);
    if (!guest) return;

    state.editingGuestId = guestId;
    const drinks = guest.beverages ?? {};

    $('g-name').value = guest.name;
    $('g-phone').value = guest.phone ?? '';
    $('g-group').value = guest.group_name;
    $('g-adults').value = guest.adults;
    $('g-children').value = guest.children;
    $('g-status').value = guest.status;
    $('g-invite-sent').checked = Boolean(guest.invite_sent);
    $('drink-beer').value = drinks.beer ?? 0;
    $('drink-cocktail').value = drinks.cocktail ?? 0;
    $('drink-soda').value = drinks.soda ?? 0;
    $('drink-juice').value = drinks.juice ?? 0;
    $('drink-water').value = drinks.water ?? 0;

    $('guest-form-title').textContent = `Editando ${guest.name}`;
    $('btn-submit-guest').textContent = 'Atualizar';
    $('btn-cancel-guest').hidden = false;
    $('guest-form').scrollIntoView({ behavior: 'smooth' });
}

function resetGuestForm() {
    state.editingGuestId = null;
    $('guest-form').reset();
    $('g-adults').value = 1;
    $('g-children').value = 0;
    ['drink-beer', 'drink-cocktail', 'drink-soda', 'drink-juice', 'drink-water']
        .forEach((id) => { $(id).value = 0; });
    $('guest-form-title').textContent = 'Adicionar convidado';
    $('btn-submit-guest').textContent = 'Adicionar';
    $('btn-cancel-guest').hidden = true;
}

// ---------- Checklist e roteiro ----------

function wireChecklist() {
    $('task-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const title = $('new-task').value.trim();
        if (!title) return;

        const saved = await mutate(() => db.createTask(state.wedding.id, {
            title,
            due_date: $('new-task-date').value || null,
            position: state.tasks.length
        }));

        if (saved) $('task-form').reset();
    });
}

function wireRunOfShow() {
    $('ros-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const title = $('ros-title').value.trim();
        const eventTime = $('ros-time').value;
        if (!title || !eventTime) return;

        const saved = await mutate(() => db.createRunOfShowItem(state.wedding.id, {
            title,
            event_time: eventTime,
            role: $('ros-role').value,
            position: state.runOfShow.length
        }));

        if (saved) {
            $('ros-title').value = '';
            $('ros-title').focus();
        }
    });
}

// ---------- Configurações ----------

function wireSettings() {
    $('wedding-form').addEventListener('submit', async (event) => {
        event.preventDefault();

        const patch = {
            partner1_name: $('w-partner1').value.trim(),
            partner2_name: $('w-partner2').value.trim(),
            wedding_date: $('w-date').value || null,
            ceremony_time: $('w-time').value || null,
            venue: $('w-venue').value.trim() || null,
            city: $('w-city').value.trim() || null,
            cover_image_url: $('w-cover').value.trim() || null
        };

        if (!patch.partner1_name || !patch.partner2_name) {
            return toast('Preencha os dois nomes.', 'error');
        }

        // O orçamento mora numa tabela à parte, que a cerimonialista não vê.
        const budget = $('w-budget').value ? num($('w-budget').value) : null;

        await mutate(async () => {
            await db.updateWedding(state.wedding.id, patch);
            await db.updateWeddingPrivate(state.wedding.id, { estimated_budget: budget });
        }, 'Dados salvos.');
    });

    $('invite-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = $('invite-email').value.trim();
        if (!email) return;

        const role = $('invite-role').value;
        const saved = await mutate(
            () => db.inviteMember(state.wedding.id, { email, role }),
            'Convite criado. Peça para a pessoa criar a conta com esse e-mail.'
        );

        if (saved) $('invite-form').reset();
    });
}

// ==========================================================

boot();
