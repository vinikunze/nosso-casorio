import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Projeto "lua de mel" — guarda o casamento e a viagem no mesmo banco.
// A chave publicável pode ficar no código: quem manda no acesso é a RLS,
// que só libera as linhas do casamento em que você é membro.
const SUPABASE_URL = 'https://ccvlaywiyvrixduvbccj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_CB2fioqF__O8x_Vt4MBVsg_axk7Ui2J';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});
