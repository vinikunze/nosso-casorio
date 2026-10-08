import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Projeto "nosso-casorio".
// A chave publicável pode ficar no código: quem manda no acesso é a RLS,
// que só libera as linhas do casamento em que você é membro — e, para a
// cerimonialista, esconde tudo que é valor.
const SUPABASE_URL = 'https://sifoxqaxqzygqxonqwlw.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_tRl0Jly4cd24yE0YhTH9kw_INuq3XzM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});
