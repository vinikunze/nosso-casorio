import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// SUAS CHAVES REAIS DO SUPABASE CONFIGURADAS
const supabaseUrl = 'https://ddsfdcsoiwpbeuwnpsve.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkc2ZkY3NvaXdwYmV1d25wc3ZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNjE3NzUsImV4cCI6MjA5MzgzNzc3NX0._M_cdXuVXAOG4cgAAmdK6lC_vkaczhGgECvi0axeP5U';

export const supabase = createClient(supabaseUrl, supabaseKey);