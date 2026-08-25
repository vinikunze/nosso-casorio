/**
 * Exportação em PDF. Usa a html2pdf carregada por <script> no dashboard.html.
 */

const PDF_STYLES = `
    .pdf { font-family: 'Inter', Arial, sans-serif; color: #14121a; background: #fff; padding: 4px; }
    .pdf-head { text-align: center; border-bottom: 2px solid #d9b169; padding-bottom: 14px; margin-bottom: 22px; }
    .pdf-head h1 { font-family: Georgia, serif; color: #a8823a; font-size: 22px; margin: 0 0 6px; }
    .pdf-head p { color: #666; font-size: 11px; margin: 0; }
    .pdf h2 { font-size: 13px; color: #a8823a; margin: 22px 0 8px; text-transform: uppercase; letter-spacing: .06em; }
    .cards { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
    .card { flex: 1 1 110px; border: 1px solid #e3e0da; border-radius: 6px; padding: 9px 11px; }
    .card span { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #777; }
    .card strong { display: block; font-size: 14px; margin-top: 3px; }
    .card.gold { background: #fdf8ee; border-color: #e6d2a8; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 6px; }
    th { background: #f5f3ef; text-align: left; padding: 7px 9px; font-size: 9px;
         text-transform: uppercase; letter-spacing: .06em; color: #666; border-bottom: 1px solid #e3e0da; }
    td { padding: 7px 9px; border-bottom: 1px solid #efedea; }
    td.num { text-align: right; white-space: nowrap; }
    td.center { text-align: center; }
    .tag { display: inline-block; padding: 2px 7px; border-radius: 99px; font-size: 9px; font-weight: 600; }
    .tag.ok { background: #dcfce7; color: #166534; }
    .tag.no { background: #fee2e2; color: #991b1b; }
    .tag.wait { background: #fef3c7; color: #92400e; }
    .foot { margin-top: 20px; text-align: center; font-size: 9px; color: #999; }
`;

function money(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL', minimumFractionDigits: 2
    });
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
    ));
}

function formatDate(isoDate) {
    if (!isoDate) return '—';
    const [year, month, day] = String(isoDate).slice(0, 10).split('-');
    return `${day}/${month}/${year}`;
}

function card(label, value, gold = false) {
    return `<div class="card ${gold ? 'gold' : ''}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

async function render(title, bodyHtml, fileName, button, state) {
    if (typeof window.html2pdf === 'undefined') {
        alert('A biblioteca de PDF ainda está carregando. Tente de novo em alguns segundos.');
        return;
    }

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Gerando...';

    const couple = `${state.wedding.partner1_name} & ${state.wedding.partner2_name}`;
    const subtitle = state.wedding.wedding_date
        ? `Casamento em ${formatDate(state.wedding.wedding_date)}`
        : 'Data a definir';

    const container = document.createElement('div');
    container.innerHTML = `
        <style>${PDF_STYLES}</style>
        <div class="pdf">
            <div class="pdf-head">
                <h1>${escapeHtml(couple)}</h1>
                <p>${escapeHtml(title)} · ${escapeHtml(subtitle)}</p>
            </div>
            ${bodyHtml}
            <p class="foot">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
        </div>`;

    try {
        await window.html2pdf().set({
            margin: 10,
            filename: fileName,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(container).save();

        button.textContent = 'Pronto';
    } catch (error) {
        console.error(error);
        button.textContent = 'Erro';
    } finally {
        setTimeout(() => {
            button.textContent = originalLabel;
            button.disabled = false;
        }, 2200);
    }
}

export function exportFinancePdf(button, state, helpers) {
    const summary = helpers.financeSummary();

    const cards = `
        <div class="cards">
            ${summary.budget > 0 ? card('Orçamento', money(summary.budget), true) : ''}
            ${card('Contratado', money(summary.contracted), true)}
            ${card('Pago', money(summary.paid))}
            ${card('Em aberto', money(summary.pending))}
            ${card('Em atraso', money(summary.overdue))}
        </div>`;

    const vendorTables = state.vendors.map((vendor) => {
        const totals = helpers.vendorTotals(vendor);
        const rows = (vendor.payments ?? []).map((payment) => `
            <tr>
                <td>${escapeHtml(payment.description)}</td>
                <td class="center">${formatDate(payment.due_date)}</td>
                <td class="num">${money(payment.amount)}</td>
                <td class="center">
                    <span class="tag ${payment.is_paid ? 'ok' : 'wait'}">${payment.is_paid ? 'Pago' : 'Em aberto'}</span>
                </td>
            </tr>`).join('');

        return `
            <h2>${escapeHtml(vendor.name)} — ${money(totals.contracted)}
                (pago ${money(totals.paid)}, falta ${money(totals.pending)})</h2>
            <table>
                <thead><tr><th>Parcela</th><th class="center">Vencimento</th>
                    <th class="num">Valor</th><th class="center">Situação</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="4">Sem parcelas.</td></tr>'}</tbody>
            </table>`;
    }).join('');

    const body = state.vendors.length
        ? cards + vendorTables
        : cards + '<p>Nenhum fornecedor cadastrado.</p>';

    return render('Relatório financeiro', body, 'Valores-Casorio.pdf', button, state);
}

export function exportGuestsPdf(button, state, helpers) {
    const totals = helpers.guestTotals();

    const STATUS = {
        confirmed: ['ok', 'Confirmado'],
        declined: ['no', 'Não vai'],
        pending: ['wait', 'Pendente']
    };

    const rows = (list) => list.map((guest) => {
        const [tag, label] = STATUS[guest.status] ?? STATUS.pending;
        return `
            <tr>
                <td>${escapeHtml(guest.name)}</td>
                <td>${escapeHtml(guest.phone || '—')}</td>
                <td>${escapeHtml(guest.group_name)}</td>
                <td class="center">${guest.adults}</td>
                <td class="center">${guest.children}</td>
                <td class="center"><span class="tag ${tag}">${label}</span></td>
            </tr>`;
    }).join('');

    const table = (list) => `
        <table>
            <thead><tr><th>Nome</th><th>Telefone</th><th>Grupo</th>
                <th class="center">Ad.</th><th class="center">Cri.</th><th class="center">Situação</th></tr></thead>
            <tbody>${rows(list)}</tbody>
        </table>`;

    const groomsmen = state.guests.filter((g) => g.group_name === 'Padrinhos');
    const others = state.guests.filter((g) => g.group_name !== 'Padrinhos');

    const body = `
        <div class="cards">
            ${card('Total', String(totals.total), true)}
            ${card('Confirmados', String(totals.confirmed))}
            ${card('Adultos', String(totals.adults))}
            ${card('Crianças', String(totals.children))}
        </div>
        ${groomsmen.length ? `<h2>Padrinhos</h2>${table(groomsmen)}` : ''}
        ${others.length ? `<h2>Convidados</h2>${table(others)}` : ''}
        ${state.guests.length ? '' : '<p>Nenhum convidado cadastrado.</p>'}`;

    return render('Lista de convidados', body, 'Convidados-Casorio.pdf', button, state);
}
