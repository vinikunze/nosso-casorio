# Nosso Casório

Painel privado do casamento — fornecedores, parcelas, convidados, checklist,
roteiro do dia e a lua de mel. Feito para duas pessoas: você e sua esposa.

Site estático (HTML, CSS e JavaScript puro, sem build) com Supabase por trás.

## Como abrir

Não tem passo de build. Basta servir a pasta:

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

Para publicar, sirva estes arquivos em qualquer hospedagem estática
(GitHub Pages, Netlify, Vercel, Cloudflare Pages).

> Abrir o `index.html` direto pelo `file://` não funciona: o navegador bloqueia
> módulos ES nesse esquema. Precisa ser via HTTP.

## Banco

Usa o projeto Supabase **`ccvlaywiyvrixduvbccj`** ("lua de mel"), que guarda o
casamento e a viagem juntos. O schema do casamento está em
[`supabase/wedding-schema.sql`](supabase/wedding-schema.sql).

A chave que está no `supabase.js` é a *publishable key* e pode ficar no código:
quem controla o acesso é a Row Level Security. Cada tabela só devolve as linhas
do casamento em que você é membro — um usuário logado que não seja membro
enxerga zero registros.

### Dando acesso para a sua esposa

1. Ela cria a conta na tela de login, em "Criar uma conta".
2. Você abre **Configurações → Quem tem acesso**, coloca o e-mail dela e clica
   em "Gerar convite".
3. Copie o código que aparece e mande para ela.
4. Ela entra e cola o código na tela que aparecer.

A partir daí vocês dois editam tudo, e as alterações aparecem na tela do outro
na hora.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `index.html`, `auth.js`, `login.css` | Login, criação de conta e recuperação de senha |
| `dashboard.html`, `dashboard.js`, `dashboard.css` | O painel e todas as telas |
| `db.js` | Todo o acesso ao Supabase, isolado num só lugar |
| `export-pdf.js` | PDF do relatório financeiro e da lista de convidados |
| `supabase.js` | Conexão |
| `global.css` | Cores, tipografia, botões e formulários |

## Detalhes que valem saber

- **Parcelas.** Ao cadastrar um fornecedor você informa o total, a entrada e o
  número de parcelas; o carnê é gerado com vencimento mensal. A última parcela
  absorve a sobra dos centavos, então a soma sempre fecha com o total exato.
- **Editar fornecedor.** Mudar nome, categoria ou observação não mexe nas
  parcelas. O carnê só é regerado se o parcelamento realmente mudar — e mesmo
  aí as parcelas já marcadas como pagas continuam pagas.
- **Bebidas.** A estimativa considera só quem confirmou presença, com 1,5 L de
  cerveja, 0,6 L de refrigerante, 0,4 L de suco e 0,5 L de água por pessoa
  marcada.
- **Datas.** São tratadas no fuso local, sem passar por UTC, para o vencimento
  não aparecer um dia deslocado.
