import * as db from './db.js';
import { exportFinancePdf, exportGuestsPdf } from './export-pdf.js';

// ==========================================================
// Estado
// ==========================================================

const state = {
    wedding: null,
    members: [],
    vendors: [],
    guests: [],
    tasks: [],
    runOfShow: [],
    honeymoon: null,
    editingVendorId: null,
    editingVendorSchedule: null,
    editingGuestId: null,
    countdownTimer: null,
    unsubscribe: null,
    reloading: false,
    reloadQueued: false
};

const CATEGORY_LABELS = {
    buffet: 'Buffet', venue: 'Espaço', photo: 'Foto e vídeo', music: 'Música',
    decor: 'Decoração', attire: 'Traje e beleza', cake: 'Bolo e doces',
    invites: 'Convites', transport: 'Transporte', church: 'Cerimônia', other: 'Outros'
};

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

// Litros por pessoa marcada em cada bebida.
const DRINK_RATIOS = { beer: 1.5, soda: 0.6, juice: 0.4, water: 0.5 };

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

    try {
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

        const [vendors, guests, tasks, runOfShow, members] = await Promise.all([
            db.fetchVendors(state.wedding.id),
            db.fetchGuests(state.wedding.id),
            db.fetchTasks(state.wedding.id),
            db.fetchRunOfShow(state.wedding.id),
            db.fetchMembers(state.wedding.id)
        ]);

        state.vendors = vendors;
        state.guests = guests;
        state.tasks = tasks;
        state.runOfShow = runOfShow;
        state.members = members;

        try {
            state.honeymoon = await db.fetchHoneymoon(state.wedding.honeymoon_trip_id);
        } catch (error) {
            console.error('Lua de mel indisponível', error);
            state.honeymoon = null;
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

    const budget = num(state.wedding?.estimated_budget);

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

    for (const guest of state.guests) {
        const a = num(guest.adults);
        const c = num(guest.children);
        adults += a;
        children += c;
        if (guest.status === 'confirmed') confirmed += a + c;
        if (guest.status === 'pending') pending += a + c;
    }

    return { adults, children, total: adults + children, confirmed, pending };
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
    renderHeader();
    renderOverview();
    renderFinance();
    renderGuests();
    renderChecklist();
    renderRunOfShow();
    renderHoneymoon();
    renderSettings();
}

function renderHeader() {
    const wedding = state.wedding;
    const names = `${wedding.partner1_name} & ${wedding.partner2_name}`;
    $('couple-names').textContent = names;

    const parts = [];
    if (wedding.wedding_date) parts.push(formatDate(wedding.wedding_date));
    if (wedding.city) parts.push(wedding.city);
    $('wedding-subtitle').textContent = parts.join(' · ') || 'Defina a data em Configurações';

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
        $('countdown-date').textContent = 'Cadastre a data em Configurações.';
        return;
    }

    if (ceremonyTime) {
        const [hour, minute] = String(ceremonyTime).split(':').map(Number);
        target.setHours(hour || 0, minute || 0, 0, 0);
    }

    $('countdown-date').textContent = formatLongDate(isoDate) +
        (ceremonyTime ? ` às ${formatTime(ceremonyTime)}` : '');

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
    const perGuest = guests.confirmed > 0 ? finance.contracted / guests.confirmed : 0;

    const cards = [
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
        { label: 'Total contratado', value: money(finance.contracted), note: `${state.vendors.length} fornecedor(es)` },
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

    $('overview-stats').innerHTML = cards.map(statCard).join('');

    // Próximos pagamentos
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

    // Barras de progresso
    const doneTasks = state.tasks.filter((t) => t.status === 'done').length;
    const taskPercent = state.tasks.length ? (doneTasks / state.tasks.length) * 100 : 0;
    const payPercent = finance.scheduled > 0 ? (finance.paid / finance.scheduled) * 100 : 0;
    const rsvpPercent = guests.total > 0 ? (guests.confirmed / guests.total) * 100 : 0;

    $('overview-progress').innerHTML = [
        meter('Pagamentos quitados', `${Math.round(payPercent)}%`, payPercent),
        meter('Checklist', `${doneTasks}/${state.tasks.length}`, taskPercent),
        meter('Confirmações', `${guests.confirmed}/${guests.total}`, rsvpPercent),
        finance.budget > 0
            ? meter('Orçamento comprometido',
                `${Math.round((finance.contracted / finance.budget) * 100)}%`,
                (finance.contracted / finance.budget) * 100,
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

    // Lista de fornecedores
    $('vendors-list').innerHTML = state.vendors.length
        ? state.vendors.map(renderVendorCard).join('')
        : '<p class="empty-state">Nenhum fornecedor cadastrado ainda. Use o formulário acima.</p>';

    renderCashflow();
}

function renderVendorCard(vendor) {
    const totals = vendorTotals(vendor);
    const category = CATEGORY_LABELS[vendor.category] ?? vendor.category;
    const meta = [category, vendor.payment_method, vendor.notes].filter(Boolean).join(' · ');

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
                        <small>${formatDate(payment.due_date)}${overdue ? ' · atrasado' : ''}</small>
                    </div>
                </div>
                <span class="payment-amount">${money(payment.amount)}</span>
            </div>`;
    }).join('');

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
        </article>`;
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

function renderGuests() {
    const totals = guestTotals();

    $('guest-stats').innerHTML = [
        { label: 'Total de pessoas', value: String(totals.total), variant: 'accent' },
        { label: 'Confirmados', value: String(totals.confirmed), variant: 'good' },
        { label: 'Pendentes', value: String(totals.pending) },
        { label: 'Adultos / crianças', value: `${totals.adults} / ${totals.children}` }
    ].map(statCard).join('');

    const groomsmen = [];
    const others = [];

    for (const guest of state.guests) {
        (guest.group_name === 'Padrinhos' ? groomsmen : others).push(renderGuestRow(guest));
    }

    $('padrinhos-list').innerHTML = groomsmen.length
        ? groomsmen.join('')
        : '<p class="empty-state">Nenhum padrinho cadastrado.</p>';
    $('guests-list').innerHTML = others.length
        ? others.join('')
        : '<p class="empty-state">Nenhum convidado cadastrado.</p>';

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

    const options = Object.entries(GUEST_STATUS).map(([value, info]) =>
        `<option value="${value}" ${guest.status === value ? 'selected' : ''}>${info.label}</option>`
    ).join('');

    return `
        <div class="row-card ${guest.status}">
            <div class="row-main">
                <strong>${escapeHtml(guest.name)}</strong>
                <small>${escapeHtml(details)}</small>
            </div>
            <div class="row-actions">
                <span class="badge ${status.badge}">${status.label}</span>
                <select class="input btn-sm" style="width:auto;padding:5px 26px 5px 9px;"
                        data-action="guest-status" data-id="${guest.id}" aria-label="Status de ${escapeHtml(guest.name)}">
                    ${options}
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

function renderChecklist() {
    const done = state.tasks.filter((task) => task.status === 'done').length;
    const percent = state.tasks.length ? Math.round((done / state.tasks.length) * 100) : 0;

    $('checklist-percent').textContent = `${percent}%`;
    $('checklist-bar').style.width = `${percent}%`;
    $('checklist-bar').className = `progress-fill ${percent >= 100 ? 'done' : ''}`;

    $('checklist-list').innerHTML = state.tasks.length
        ? state.tasks.map((task) => {
            const status = TASK_STATUS[task.status] ?? TASK_STATUS.pending;
            const options = Object.entries(TASK_STATUS).map(([value, info]) =>
                `<option value="${value}" ${task.status === value ? 'selected' : ''}>${info.label}</option>`
            ).join('');
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
                        <select class="input btn-sm" style="width:auto;padding:5px 26px 5px 9px;"
                                data-action="task-status" data-id="${task.id}"
                                aria-label="Status de ${escapeHtml(task.title)}">${options}</select>
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
}

function renderHoneymoon() {
    const container = $('honeymoon-content');
    const trip = state.honeymoon;

    if (!trip) {
        container.innerHTML = `
            <p class="empty-state">
                Nenhuma viagem vinculada. Cadastre a lua de mel no app de viagem e ela aparece aqui.
            </p>`;
        return;
    }

    const expenses = trip.expenses ?? [];
    const planned = expenses.reduce((sum, e) => sum + num(e.planned_amount ?? e.actual_amount), 0);
    const actual = expenses.reduce((sum, e) => sum + num(e.actual_amount ?? e.planned_amount), 0);
    const paid = expenses.reduce((sum, e) => sum + num(e.paid_amount), 0);

    const period = trip.start_date && trip.end_date
        ? `${formatDate(trip.start_date)} a ${formatDate(trip.end_date)}`
        : 'Datas a definir';

    const destinations = (trip.destinations ?? []).map((destination, index) => `
        <span class="chip"><span class="chip-index">${index + 1}</span>${escapeHtml(destination.city)}</span>
    `).join('');

    const expenseRows = expenses.length
        ? expenses.map((expense) => {
            const total = num(expense.actual_amount ?? expense.planned_amount);
            const paidAmount = num(expense.paid_amount);
            const settled = paidAmount >= total - 0.005 && total > 0;
            return `
                <div class="row-card ${settled ? 'done' : 'pending'}">
                    <div class="row-main">
                        <strong>${escapeHtml(expense.description)}</strong>
                        <small>Pago ${money(paidAmount)} de ${money(total)}</small>
                    </div>
                    <span class="badge ${settled ? 'success' : 'warning'}">
                        ${settled ? 'Quitado' : money(total - paidAmount) + ' em aberto'}
                    </span>
                </div>`;
        }).join('')
        : '<p class="empty-state">Nenhum gasto lançado na viagem.</p>';

    const checklists = (trip.checklists ?? []).map((list) => {
        const items = (list.checklist_items ?? []).map((item) => `
            <div class="check-row ${item.is_done ? 'done' : ''}">
                <input type="checkbox" id="hm-${item.id}" ${item.is_done ? 'checked' : ''}
                       data-action="toggle-honeymoon-item" data-id="${item.id}">
                <label for="hm-${item.id}">${escapeHtml(item.title)}</label>
            </div>`).join('');

        const doneCount = (list.checklist_items ?? []).filter((i) => i.is_done).length;

        return `
            <div class="panel">
                <h3 class="panel-title">${escapeHtml(list.title)}
                    <span class="badge neutral">${doneCount}/${(list.checklist_items ?? []).length}</span>
                </h3>
                ${items || '<p class="empty-state">Lista vazia.</p>'}
            </div>`;
    }).join('');

    const stays = (trip.accommodations ?? []).map((stay) => `
        <div class="row-card">
            <div class="row-main">
                <strong>${escapeHtml(stay.name)}</strong>
                <small>${escapeHtml(stay.address ?? '')}</small>
            </div>
            <span class="badge neutral">${money(stay.total_price)}</span>
        </div>`).join('');

    const flights = (trip.flights ?? []).map((flight) => `
        <div class="row-card">
            <div class="row-main">
                <strong>${escapeHtml(flight.airline ?? 'Voo')} ${escapeHtml(flight.flight_number ?? '')}</strong>
                <small>${escapeHtml(flight.origin_iata ?? '')} → ${escapeHtml(flight.destination_iata ?? '')}</small>
            </div>
            <span class="badge neutral">${money(flight.total_price)}</span>
        </div>`).join('');

    container.innerHTML = `
        <div class="trip-hero">
            <h3>${escapeHtml(trip.name)}</h3>
            <p>${escapeHtml(trip.destination_label ?? '')} · ${period} · ${num(trip.travelers_count)} viajante(s)</p>
            ${destinations ? `<div class="chip-row">${destinations}</div>` : ''}
        </div>

        <div class="stat-grid">
            ${[
            trip.estimated_budget
                ? { label: 'Orçamento da viagem', value: money(trip.estimated_budget), variant: 'accent' }
                : { label: 'Orçamento da viagem', value: 'Não definido' },
            { label: 'Previsto', value: money(planned) },
            { label: 'Já pago', value: money(paid), variant: 'good' },
            {
                label: 'Falta pagar',
                value: money(Math.max(0, actual - paid)),
                variant: actual - paid > 0 ? 'bad' : ''
            }
        ].map(statCard).join('')}
        </div>

        <div class="panel"><h3 class="panel-title">Gastos da viagem</h3>${expenseRows}</div>
        ${stays ? `<div class="panel"><h3 class="panel-title">Hospedagem</h3>${stays}</div>` : ''}
        ${flights ? `<div class="panel"><h3 class="panel-title">Voos</h3>${flights}</div>` : ''}
        ${checklists}`;
}

function renderSettings() {
    const wedding = state.wedding;

    const setIfIdle = (id, value) => {
        const element = $(id);
        if (element && document.activeElement !== element) element.value = value ?? '';
    };

    setIfIdle('w-partner1', wedding.partner1_name);
    setIfIdle('w-partner2', wedding.partner2_name);
    setIfIdle('w-date', wedding.wedding_date);
    setIfIdle('w-time', formatTime(wedding.ceremony_time));
    setIfIdle('w-budget', wedding.estimated_budget);
    setIfIdle('w-venue', wedding.venue);
    setIfIdle('w-city', wedding.city);
    setIfIdle('w-cover', wedding.cover_image_url);

    $('members-list').innerHTML = state.members.map((member) => {
        const accepted = member.invite_status === 'accepted';
        const name = member.display_name || member.invited_email || 'Membro';
        const roleLabel = member.role === 'owner' ? 'Dono' : member.role === 'editor' ? 'Edita' : 'Só vê';

        return `
            <div class="row-card ${accepted ? 'confirmed' : 'pending'}">
                <div class="row-main">
                    <strong>${escapeHtml(name)}</strong>
                    <small>${roleLabel}${accepted ? '' : ` · código: ${escapeHtml(member.invite_token)}`}</small>
                </div>
                <div class="row-actions">
                    <span class="badge ${accepted ? 'success' : 'warning'}">
                        ${accepted ? 'Ativo' : 'Convite pendente'}
                    </span>
                    ${accepted ? '' : `<button class="btn btn-sm" data-action="copy-invite"
                        data-token="${escapeHtml(member.invite_token)}">Copiar código</button>`}
                    ${member.role === 'owner' ? '' : `<button class="icon-btn delete" data-action="remove-member"
                        data-id="${member.id}" title="Remover">✕</button>`}
                </div>
            </div>`;
    }).join('') || '<p class="empty-state">Só você tem acesso.</p>';
}

// ==========================================================
// Eventos
// ==========================================================

function wireEvents() {
    // Navegação
    document.querySelectorAll('.nav-btn[data-target]').forEach((button) => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
            document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
            button.classList.add('active');
            $(button.dataset.target).classList.add('active');
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
}

function closeMenu() {
    $('sidebar').classList.remove('open');
    $('scrim').hidden = true;
    $('btn-menu').setAttribute('aria-expanded', 'false');
}

async function onDelegatedClick(event) {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;
    const { action, id, token } = trigger.dataset;

    if (action === 'edit-vendor') return startVendorEdit(id);
    if (action === 'edit-guest') return startGuestEdit(id);

    if (action === 'delete-vendor') {
        const vendor = state.vendors.find((v) => v.id === id);
        if (!confirm(`Excluir "${vendor?.name}" e todas as parcelas dele?`)) return;
        return mutate(() => db.deleteVendor(id), 'Fornecedor excluído.');
    }

    if (action === 'delete-guest') {
        const guest = state.guests.find((g) => g.id === id);
        if (!confirm(`Remover "${guest?.name}" da lista?`)) return;
        return mutate(() => db.deleteGuest(id), 'Convidado removido.');
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
            toast('Código copiado. Mande para o seu par.', 'success');
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
    if (action === 'guest-status') {
        return mutate(() => db.updateGuest(id, { status: trigger.value }));
    }
    if (action === 'task-status') {
        return mutate(() => db.updateTask(id, { status: trigger.value }));
    }
    if (action === 'toggle-honeymoon-item') {
        setSync('saving');
        try {
            await db.setHoneymoonItemDone(id, trigger.checked);
            state.honeymoon = await db.fetchHoneymoon(state.wedding.honeymoon_trip_id);
            renderHoneymoon();
            setSync('ok');
        } catch (error) {
            console.error(error);
            setSync('error');
            toast('Não foi possível atualizar a lista da viagem.', 'error');
        }
    }
}

// ---------- Fornecedores ----------

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

/** Identidade do carnê, para detectar se o parcelamento mudou. */
function scheduleSignature(payments) {
    return JSON.stringify(
        (payments ?? []).map((p) => [p.description, round2(p.amount), p.dueDate ?? p.due_date ?? null])
    );
}

function readVendorForm() {
    const total = num($('v-total').value);
    const entry = num($('v-entry').value);
    const installments = parseInt($('v-installments').value, 10) || 0;
    const firstDate = $('v-date').value;

    return {
        vendor: {
            name: $('v-name').value.trim(),
            category: $('v-category').value,
            payment_method: $('v-method').value.trim() || null,
            total_amount: total,
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
        const { vendor, payments, total, entry } = readVendorForm();

        if (!vendor.name) return toast('Informe o nome do fornecedor.', 'error');
        if (total <= 0) return toast('Informe um valor total maior que zero.', 'error');
        if (entry > total) return toast('A entrada não pode passar do valor total.', 'error');
        if (!payments.length) return toast('Defina a entrada ou o número de parcelas.', 'error');

        const editingId = state.editingVendorId;

        // Regerar o carnê apaga e recria as parcelas; só faz isso se elas
        // realmente mudaram, para não mexer no que já está lançado à toa.
        const scheduleChanged = scheduleSignature(payments) !== state.editingVendorSchedule;

        const saved = await mutate(
            () => editingId
                ? db.updateVendor(editingId, vendor, scheduleChanged ? payments : null)
                : db.createVendor(state.wedding.id, vendor, payments),
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
    state.editingVendorSchedule = scheduleSignature(vendor.payments);
    const payments = vendor.payments ?? [];
    const entryPayment = payments.find((p) => p.description === 'Entrada');
    const installments = payments.filter((p) => p !== entryPayment);

    $('v-name').value = vendor.name;
    $('v-category').value = vendor.category ?? 'other';
    $('v-method').value = vendor.payment_method ?? '';
    $('v-total').value = vendor.total_amount ?? '';
    $('v-notes').value = vendor.notes ?? '';
    $('v-entry').value = entryPayment ? entryPayment.amount : '';
    $('v-installments').value = installments.length;
    $('v-date').value = payments[0]?.due_date ?? '';

    $('vendor-form-title').textContent = `Editando ${vendor.name}`;
    $('btn-submit-vendor').textContent = 'Atualizar';
    $('btn-cancel-vendor').hidden = false;
    $('vendor-form-hint').textContent = 'As parcelas serão recriadas; as já marcadas como pagas continuam pagas.';

    $('finance').scrollIntoView({ behavior: 'smooth' });
}

function resetVendorForm() {
    state.editingVendorId = null;
    state.editingVendorSchedule = null;
    $('vendor-form').reset();
    $('v-installments').value = 1;
    $('vendor-form-title').textContent = 'Cadastrar fornecedor';
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
            estimated_budget: $('w-budget').value ? num($('w-budget').value) : null,
            venue: $('w-venue').value.trim() || null,
            city: $('w-city').value.trim() || null,
            cover_image_url: $('w-cover').value.trim() || null
        };

        if (!patch.partner1_name || !patch.partner2_name) {
            return toast('Preencha os dois nomes.', 'error');
        }

        await mutate(() => db.updateWedding(state.wedding.id, patch), 'Dados salvos.');
    });

    $('invite-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = $('invite-email').value.trim();
        if (!email) return;

        const saved = await mutate(
            () => db.inviteMember(state.wedding.id, email),
            'Convite gerado. Copie o código e mande para ela.'
        );

        if (saved) $('invite-form').reset();
    });
}

// ==========================================================

boot();
