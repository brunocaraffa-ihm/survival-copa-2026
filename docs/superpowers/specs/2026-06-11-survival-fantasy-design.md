# Survival Fantasy — Copa do Mundo 2026

**Data:** 2026-06-11
**Autor:** Bruno Caraffa
**Status:** Aprovado (design)

## 1. Visão geral

Web app onde um grupo fechado de amigos joga um *survival* durante a Copa do Mundo
FIFA 2026 (11/jun–19/jul/2026). Cada participante loga com uma senha gerada pelo
admin, registra **1 palpite por dia de jogo** (um time que joga naquele dia e que
ele ainda não usou) e sobrevive enquanto o time escolhido não perder. **Empate
salva.** Quem sobrevive mais tempo vence.

Hospedagem 100% gratuita: **Next.js (App Router) na Vercel** + **Postgres no
Supabase** + **Vercel Cron** para liquidação automática dos resultados.

### Participantes iniciais

| Nome        | Usuário (sugerido) | Papel |
| ----------- | ------------------ | ----- |
| Rato        | `rato`             | jogador |
| Bitu        | `bitu`             | jogador |
| Bruno       | `bruno`            | jogador + **admin** |
| Bigode      | `bigode`           | jogador |
| Pedro Paulo | `pedropaulo`       | jogador |

## 2. Regras do jogo (motor de sobrevivência)

- **Dia de jogo:** uma data no fuso **America/Sao_Paulo (Brasília)** que tenha ≥1
  partida da Copa.
- **1 palpite por dia de jogo:** o participante escolhe **um time** que joga naquele
  dia.
- **Deadline diário = horário de início do primeiro jogo do dia** (no fuso de
  Brasília). O palpite pode ser criado/trocado livremente até o deadline; depois
  trava.
- **Sem repetição de time:** um time já escolhido por um participante não pode ser
  reutilizado por ele em todo o torneio.
- **Sobrevivência:** o palpite **sobrevive** se o time **vencer ou empatar** no
  resultado do **tempo normal/prorrogação**. Derrota nos **pênaltis ainda salva**
  (empate conta como sobrevivência independentemente da disputa de pênaltis).
- **Eliminação:** o palpite é eliminado se o time **perder** no tempo normal/prorrogação.
- **Sem palpite no deadline:** participante **vivo** que não registrou palpite até o
  deadline do dia é **eliminado**.
- **Dia sem jogo:** ninguém precisa palpitar e ninguém é eliminado.
- **Vencedor:** quem sobrevive mais tempo (maior data de sobrevivência). Se mais de
  um participante chega vivo ao fim do torneio, ou se os últimos vivos caem todos no
  **mesmo dia**, o título é **compartilhado**.

### Casos de borda

- **Múltiplos jogos no mesmo dia:** o participante escolhe um único time entre todos
  os que jogam naquele dia. O deadline continua sendo o primeiro jogo do dia (todos
  travam juntos), mesmo que o time escolhido jogue mais tarde.
- **Jogo adiado/cancelado:** se a partida do time escolhido não tem resultado
  FINISHED, a liquidação daquele participante fica pendente até haver resultado
  (nenhuma eliminação prematura). O admin pode corrigir manualmente.
- **Participante já eliminado:** não palpita mais; aparece no ranking com a data e o
  motivo da queda.

## 3. Visibilidade

- **Palpite próprio:** sempre visível para o dono.
- **Palpite dos outros:** **escondido até o deadline do dia** (primeiro apito).
  Depois do deadline, todos veem todos os palpites daquele dia.
- **Ranking** (vivos / eliminados, com data e motivo): sempre visível para todos.

A regra é **aplicada no servidor**: a API não retorna o palpite de outro participante
para um dia cujo deadline ainda não passou. Não é possível burlar via cliente.

## 4. Resultados — automático com rede de segurança

- **Fonte primária:** API gratuita [football-data.org](https://www.football-data.org/)
  (competição FIFA World Cup). Tier grátis tem limite de requisições (~10/min).
- **Cron na Vercel** executa a liquidação algumas vezes ao dia: busca os placares dos
  jogos do dia, atualiza `matches` e processa eliminações.
- **Rede de segurança (obrigatória):** o admin tem uma **tela de override manual**
  para cadastrar/corrigir o placar e o status de qualquer partida, e para cadastrar
  fixtures manualmente. O automático preenche; o admin corrige se a API falhar ou
  divergir. Isso remove a dependência total da API em jogos decisivos.
- **Idempotência:** a liquidação só age sobre partidas com status `FINISHED` e nunca
  elimina o mesmo participante duas vezes. Reexecutar o cron é seguro.

### Risco conhecido

O tier gratuito do football-data.org pode não cobrir a Copa do Mundo de forma
completa/estável. **Mitigação:** (1) a estrutura de fixtures pode ser semeada
manualmente a partir do calendário público da Copa (104 jogos, datas/horários
conhecidos); (2) o override manual do admin sempre permite registrar resultados sem
a API. A integração automática é uma conveniência, não um ponto único de falha.

## 5. Arquitetura

```
Next.js (App Router) na Vercel
├── Páginas (React Server Components + Client Components)
│   ├── /login
│   ├── /            (dashboard do jogador)
│   └── /admin       (somente admin)
├── Server Actions / Route Handlers
│   ├── auth        (login / logout, sessão por cookie httpOnly assinado)
│   ├── picks       (criar/trocar palpite; ler palpites do dia com visibilidade)
│   ├── standings   (ranking)
│   └── admin       (cadastrar participantes, override de resultado/fixture)
├── /api/cron/settle  (protegido por segredo) — liquidação dos resultados
└── Acesso a dados via Drizzle ORM → Postgres (Supabase)
```

- **Auth:** sem signup. O admin cadastra participantes; o sistema gera uma senha
  aleatória por participante. Login = usuário + senha → verificação `bcrypt` →
  cookie de sessão httpOnly assinado (JWT). Grupo fechado.
- **Fuso:** kickoff sempre armazenado em **UTC**; data-BRT e deadline calculados por
  um único utilitário de timezone (America/Sao_Paulo). Evita bugs de fuso.

## 6. Modelo de dados (Postgres / Drizzle)

```
participants
  id            uuid pk
  name          text
  username      text unique
  password_hash text
  is_admin      boolean default false
  status        text  -- 'alive' | 'eliminated'
  eliminated_date date null
  eliminated_reason text null  -- 'lost' | 'no_pick'
  created_at    timestamptz

matches
  id            uuid pk
  external_id   text unique null   -- id na football-data.org
  utc_kickoff   timestamptz
  match_date    date               -- data no fuso de Brasília (derivada)
  stage         text               -- group / round_of_32 / ... / final
  home_team     text
  away_team     text
  home_score    int null
  away_score    int null
  status        text               -- 'SCHEDULED' | 'IN_PLAY' | 'FINISHED'
  winner        text null          -- 'HOME' | 'AWAY' | 'DRAW' (tempo normal/ET)

picks
  id            uuid pk
  participant_id uuid fk
  match_date    date               -- dia do palpite (BRT)
  team          text               -- time escolhido
  match_id      uuid fk            -- jogo do time naquele dia
  created_at    timestamptz
  UNIQUE (participant_id, match_date)   -- 1 palpite por dia
  UNIQUE (participant_id, team)         -- sem repetir time
```

O estado vivo/eliminado é **materializado** em `participants` (atualizado pela
liquidação) para leitura simples do ranking, mas é sempre rederivável dos `picks` +
`matches`.

## 7. Fluxos principais

### 7.1 Onboarding
Admin abre `/admin` → digita nomes → sistema gera senhas aleatórias → admin recebe
uma tabela (nome + usuário + senha + link de login) para distribuir no grupo.

### 7.2 Palpite do dia
Participante vivo, antes do deadline, vê os times que jogam hoje e que ele ainda não
usou → escolhe um → confirma. Pode trocar até o deadline. Validações no servidor:
está vivo, antes do deadline, o time joga hoje, o time não foi usado antes.

### 7.3 Liquidação (cron)
1. Busca resultados dos jogos do dia (API) e atualiza `matches`.
2. Para cada participante **vivo** com palpite no dia cujo jogo está `FINISHED`:
   sobrevive se o time venceu/empatou; senão `eliminated` com motivo `lost`.
3. Para cada participante **vivo** **sem** palpite num dia já encerrado (deadline
   passou e há ≥1 jogo): `eliminated` com motivo `no_pick`.
4. Recalcula vencedor(es) quando o torneio termina ou só resta ≤1 vivo.

## 8. Tratamento de erros

- Erros de validação de palpite são exibidos com mensagem clara (time já usado,
  deadline encerrado, não está vivo, time não joga hoje).
- Liquidação idempotente; só age em `FINISHED`. Se a API cair, nenhuma eliminação
  por resultado acontece até haver placar (override manual disponível).
- Correção de fuso centralizada num único utilitário testado.

## 9. Estratégia de testes

- **Unitário (TDD — coração do sistema):** motor de regras — vitória/empate/derrota,
  derrota nos pênaltis salva, sem-palpite elimina, time repetido bloqueado, trava de
  deadline, idempotência da liquidação, determinação do(s) vencedor(es).
- **Integração:** envio de palpite (auth + validação + visibilidade), endpoint de
  liquidação com fixtures/resultados mockados.
- Dataset de fixtures de teste semeado para cenários determinísticos.

## 10. Fora de escopo (YAGNI)

- Cadastro público / recuperação de senha automatizada (admin redefine manualmente).
- Revival / segunda chance após eliminação.
- Apostas em dinheiro, pagamentos, notificações push.
- App mobile nativo (o site responsivo atende).
```
