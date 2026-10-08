# Nosso Casório

Painel privado do casamento — fornecedores, parcelas, convidados, checklist,
roteiro do dia. Feito para o casal, com um acesso separado para
a cerimonialista acompanhar junto.

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

Usa o projeto Supabase **`nosso-casorio`** (`sifoxqaxqzygqxonqwlw`). O schema
completo está em [`supabase/wedding-schema.sql`](supabase/wedding-schema.sql) —
dá para recriar o banco do zero só com ele.

A chave que está no `supabase.js` é a *publishable key* e pode ficar no código:
quem controla o acesso é a Row Level Security. Cada tabela só devolve as linhas
do casamento em que você é membro — um usuário logado que não seja membro
enxerga zero registros.

### Quem pode o quê

A cerimonialista vê **tudo, menos valores em dinheiro**.

| | Casal (dono e par) | Cerimonialista |
| --- | --- | --- |
| Convidados, convites, bebidas | vê e edita | vê e edita |
| Fornecedores: contato, situação, o que falta, horário de chegada | vê e edita | vê e edita (não exclui) |
| Checklist e roteiro do dia | vê e edita | vê e edita |
| Pagamentos | vê e edita, com valores | vê parcela por parcela (paga, a vencer, atrasada) e quem está quitado, **sem valores** |
| Orçamento | vê e edita | **não vê** |
| Configurações | edita; só o dono convida e troca acessos | só leitura |

Isso é garantido no banco, não só na tela: o que é dinheiro mora em tabelas
separadas (`vendor_contracts`, `vendor_payments`, `wedding_private`) que a RLS
esconde dela. O andamento dos pagamentos chega por uma função que devolve tudo
menos o dinheiro: `get_payment_status`.

> A aba de lua de mel foi tirada do site. A tabela `honeymoon_items`, as
> colunas `honeymoon_*` de `wedding_private` e a função
> `get_honeymoon_overview` continuam no banco, vazias e sem uso, caso um dia
> ela volte.

### Dando acesso a alguém

1. Em **Configurações → Quem tem acesso**, coloque o e-mail da pessoa, escolha
   "Meu par — acesso total" ou "Cerimonialista — sem valores" e clique em
   **Convidar**.
2. A pessoa cria a conta na tela de login, em "Criar uma conta", **com esse
   mesmo e-mail**, e clica no link de confirmação que chega no e-mail dela.
3. Ao entrar, ela já cai direto no casamento. (Se algo der errado, o código que
   aparece na lista de acessos ainda funciona: ela cola na tela que aparecer.)

O acesso pode ser trocado depois na mesma lista (por exemplo, dar acesso total
à cerimonialista).

> A confirmação de e-mail precisa ficar **ligada** no Supabase
> (Authentication → Sign In / Providers → Email → "Confirm email"). É ela que
> impede alguém de criar conta com o e-mail da cerimonialista e entrar no
> lugar dela. Em Authentication → URL Configuration, o endereço onde o site
> está publicado precisa estar em *Site URL* e em *Redirect URLs*, senão o
> link de confirmação manda para o lugar errado.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `index.html`, `auth.js`, `login.css` | Login, criação de conta e recuperação de senha |
| `dashboard.html`, `dashboard.js`, `dashboard.css` | O painel e todas as telas |
| `db.js` | Todo o acesso ao Supabase, isolado num só lugar |
| `export-pdf.js` | PDF do relatório financeiro, dos fornecedores e da lista de convidados |
| `supabase.js` | Conexão |
| `global.css` | Cores, tipografia, botões e formulários |

## Detalhes que valem saber

- **Fornecedores × Valores.** A aba *Fornecedores* é a lista um por um:
  contato, situação (urgente / falta acertar / estamos pagando / tudo certo), o que falta
  resolver e o horário de chegada no dia. A aba *Valores* é o contrato e o
  carnê. Um fornecedor pode existir só na primeira; para lançar os valores
  dele, use "Lançar valores" na aba Valores.
- **Save the date e convite.** Cada convidado tem duas marcações separadas:
  *Save the date* e *Convite físico*. Cada linha da lista conta como um envio
  (uma família = um save the date e um convite). Os filtros "Falta save the
  date" e "Falta convite físico" mostram quem ainda não recebeu, ignorando quem
  já disse que não vai.

- **Parcelas.** Ao cadastrar um fornecedor você informa o total, a entrada e o
  número de parcelas; o carnê é gerado com vencimento mensal. A última parcela
  absorve a sobra dos centavos, então a soma sempre fecha com o total exato.
- **Ajustar uma parcela sozinha.** O vencimento e o valor de cada parcela são
  editáveis direto na lista — útil quando um fornecedor cobra em meses fora da
  sequência mensal. A lista se reordena por data de vencimento depois do
  ajuste. Se as parcelas deixarem de somar o total do contrato, aparece um
  aviso com a diferença em vez de a divergência passar batida.
- **Editar fornecedor.** Mudar nome, categoria ou observação não mexe nas
  parcelas, e os ajustes manuais de data e valor continuam de pé. O carnê só é
  regerado se você mexer em valor total, entrada, nº de parcelas ou 1º
  vencimento — e mesmo aí as parcelas já marcadas como pagas continuam pagas.
- **Bebidas.** A estimativa considera só quem confirmou presença, com 1,5 L de
  cerveja, 0,6 L de refrigerante, 0,4 L de suco e 0,5 L de água por pessoa
  marcada.
- **Datas.** São tratadas no fuso local, sem passar por UTC, para o vencimento
  não aparecer um dia deslocado.
