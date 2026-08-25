import { supabase } from './supabase.js';

/**
 * Camada de acesso ao banco.
 * Cada função devolve dados já prontos para a tela; a RLS do Supabase
 * garante que só vem o que é do casamento em que você é membro.
 */

// ---------------------------------------------------------
// Sessão
// ---------------------------------------------------------

export async function getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
}

export async function signOut() {
    await supabase.auth.signOut();
}

// ---------------------------------------------------------
// Casamento
// ---------------------------------------------------------

export async function fetchWedding() {
    const { data, error } = await supabase
        .from('weddings')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    return data;
}

export async function createWedding({ partner1Name, partner2Name, weddingDate }) {
    const session = await getSession();
    if (!session) throw new Error('Sessão expirada.');

    const { data, error } = await supabase
        .from('weddings')
        .insert({
            owner_id: session.user.id,
            partner1_name: partner1Name,
            partner2_name: partner2Name,
            wedding_date: weddingDate || null
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function updateWedding(weddingId, patch) {
    const { error } = await supabase.from('weddings').update(patch).eq('id', weddingId);
    if (error) throw error;
}

export async function acceptInvite(token) {
    const { data, error } = await supabase.rpc('accept_wedding_invite', { p_token: token });
    if (error) throw error;
    return data;
}

export async function fetchMembers(weddingId) {
    const { data, error } = await supabase
        .from('wedding_members')
        .select('*')
        .eq('wedding_id', weddingId)
        .order('created_at', { ascending: true });

    if (error) throw error;
    return data ?? [];
}

export async function inviteMember(weddingId, email, displayName) {
    const session = await getSession();
    const { data, error } = await supabase
        .from('wedding_members')
        .insert({
            wedding_id: weddingId,
            invited_email: email.trim().toLowerCase(),
            display_name: displayName || null,
            role: 'editor',
            invited_by: session?.user?.id ?? null
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function removeMember(memberId) {
    const { error } = await supabase.from('wedding_members').delete().eq('id', memberId);
    if (error) throw error;
}

// ---------------------------------------------------------
// Fornecedores e parcelas
// ---------------------------------------------------------

export async function fetchVendors(weddingId) {
    const { data, error } = await supabase
        .from('vendors')
        .select('*, payments:vendor_payments(*)')
        .eq('wedding_id', weddingId)
        .order('created_at', { ascending: true });

    if (error) throw error;

    return (data ?? []).map((vendor) => ({
        ...vendor,
        payments: [...(vendor.payments ?? [])].sort(comparePayments)
    }));
}

function comparePayments(a, b) {
    if (a.due_date && b.due_date && a.due_date !== b.due_date) {
        return a.due_date < b.due_date ? -1 : 1;
    }
    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;
    return (a.position ?? 0) - (b.position ?? 0);
}

export async function createVendor(weddingId, vendor, payments) {
    const { data, error } = await supabase
        .from('vendors')
        .insert({ wedding_id: weddingId, ...vendor })
        .select()
        .single();

    if (error) throw error;

    if (payments?.length) {
        await replacePayments(data.id, payments);
    }
    return data;
}

export async function updateVendor(vendorId, vendor, payments) {
    const { error } = await supabase.from('vendors').update(vendor).eq('id', vendorId);
    if (error) throw error;

    if (payments) {
        await replacePayments(vendorId, payments);
    }
}

/**
 * Regera o carnê do fornecedor preservando o que já foi marcado como pago,
 * casando pela posição da parcela.
 */
async function replacePayments(vendorId, payments) {
    const { data: existing, error: readError } = await supabase
        .from('vendor_payments')
        .select('position, is_paid, paid_at')
        .eq('vendor_id', vendorId);

    if (readError) throw readError;

    const paidByPosition = new Map(
        (existing ?? []).filter((p) => p.is_paid).map((p) => [p.position, p])
    );

    const { error: deleteError } = await supabase
        .from('vendor_payments')
        .delete()
        .eq('vendor_id', vendorId);

    if (deleteError) throw deleteError;

    const rows = payments.map((payment, index) => {
        const previous = paidByPosition.get(index);
        return {
            vendor_id: vendorId,
            description: payment.description,
            amount: payment.amount,
            due_date: payment.dueDate || null,
            position: index,
            is_paid: previous?.is_paid ?? false,
            paid_at: previous?.paid_at ?? null
        };
    });

    if (!rows.length) return;

    const { error: insertError } = await supabase.from('vendor_payments').insert(rows);
    if (insertError) throw insertError;
}

export async function deleteVendor(vendorId) {
    const { error } = await supabase.from('vendors').delete().eq('id', vendorId);
    if (error) throw error;
}

export async function setPaymentPaid(paymentId, isPaid) {
    const { error } = await supabase
        .from('vendor_payments')
        .update({ is_paid: isPaid })
        .eq('id', paymentId);

    if (error) throw error;
}

// ---------------------------------------------------------
// Convidados
// ---------------------------------------------------------

export async function fetchGuests(weddingId) {
    const { data, error } = await supabase
        .from('guests')
        .select('*')
        .eq('wedding_id', weddingId)
        .order('name', { ascending: true });

    if (error) throw error;
    return data ?? [];
}

export async function createGuest(weddingId, guest) {
    const { error } = await supabase.from('guests').insert({ wedding_id: weddingId, ...guest });
    if (error) throw error;
}

export async function updateGuest(guestId, patch) {
    const { error } = await supabase.from('guests').update(patch).eq('id', guestId);
    if (error) throw error;
}

export async function deleteGuest(guestId) {
    const { error } = await supabase.from('guests').delete().eq('id', guestId);
    if (error) throw error;
}

// ---------------------------------------------------------
// Checklist
// ---------------------------------------------------------

export async function fetchTasks(weddingId) {
    const { data, error } = await supabase
        .from('wedding_tasks')
        .select('*')
        .eq('wedding_id', weddingId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });

    if (error) throw error;
    return data ?? [];
}

export async function createTask(weddingId, task) {
    const { error } = await supabase.from('wedding_tasks').insert({ wedding_id: weddingId, ...task });
    if (error) throw error;
}

export async function updateTask(taskId, patch) {
    const { error } = await supabase.from('wedding_tasks').update(patch).eq('id', taskId);
    if (error) throw error;
}

export async function deleteTask(taskId) {
    const { error } = await supabase.from('wedding_tasks').delete().eq('id', taskId);
    if (error) throw error;
}

// ---------------------------------------------------------
// Roteiro do dia (run of show)
// ---------------------------------------------------------

export async function fetchRunOfShow(weddingId) {
    const { data, error } = await supabase
        .from('run_of_show_items')
        .select('*')
        .eq('wedding_id', weddingId)
        .order('event_time', { ascending: true });

    if (error) throw error;
    return data ?? [];
}

export async function createRunOfShowItem(weddingId, item) {
    const { error } = await supabase.from('run_of_show_items').insert({ wedding_id: weddingId, ...item });
    if (error) throw error;
}

export async function deleteRunOfShowItem(itemId) {
    const { error } = await supabase.from('run_of_show_items').delete().eq('id', itemId);
    if (error) throw error;
}

// ---------------------------------------------------------
// Lua de mel (reaproveita as tabelas de viagem já existentes)
// ---------------------------------------------------------

export async function fetchHoneymoon(tripId) {
    const query = supabase
        .from('trips')
        .select(`
            *,
            destinations (*),
            expenses (*),
            accommodations (*),
            flights (*),
            checklists (*, checklist_items (*))
        `)
        .order('created_at', { ascending: true })
        .limit(1);

    const { data, error } = tripId
        ? await query.eq('id', tripId).maybeSingle()
        : await query.maybeSingle();

    if (error) throw error;
    if (!data) return null;

    data.destinations = (data.destinations ?? []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    data.checklists = (data.checklists ?? [])
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((list) => ({
            ...list,
            checklist_items: (list.checklist_items ?? []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        }));

    return data;
}

export async function setHoneymoonItemDone(itemId, isDone) {
    const { error } = await supabase.from('checklist_items').update({ is_done: isDone }).eq('id', itemId);
    if (error) throw error;
}

// ---------------------------------------------------------
// Tempo real
// ---------------------------------------------------------

const WEDDING_TABLES = ['weddings', 'vendors', 'vendor_payments', 'guests', 'wedding_tasks', 'run_of_show_items'];

export function subscribeToChanges(onChange) {
    const channel = supabase.channel('nosso-casorio');

    for (const table of WEDDING_TABLES) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange);
    }

    channel.subscribe();
    return () => supabase.removeChannel(channel);
}
