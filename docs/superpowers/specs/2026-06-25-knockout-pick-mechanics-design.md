# Mata-mata — Mecânica de Palpites (Grupos de 4)

**Data:** 2026-06-25
**Autor:** Bruno Caraffa
**Status:** Aprovado (design)
**Spec irmão:** `2026-06-25-knockout-bracket-projection-design.md` (Projeção do chaveamento — etapa 2)

## 1. Visão geral

Na fase de grupos o palpite é por **Match Day** (um dia de jogos). No mata-mata
essa divisão fica injusta (dias com poucos jogos, ou grupos misturados). Esta
mudança troca a unidade de palpite do mata-mata por **grupos de jogos de tamanho
fixo por estágio**, mantendo a fase de grupos exatamente como está.

No mata-mata, **a cada grupo de jogos o participante escolhe 1 time**, que **não
pode repetir** dentro do mata-mata. O que vale é **classificar** (empate não
salva: tem que avançar, inclusive nos pênaltis). Quem fica sem time elegível pra
escolher é **eliminado**. As vidas continuam valendo (3, vindas da fase de
grupos). No fim, **quem cravou o campeão ganha**; senão, mais vidas; senão,
divide.

## 2. Estrutura dos grupos do mata-mata

Os jogos de cada estágio são ordenados por horário de início (kickoff) e fatiados
por um tamanho fixo. O jogo de **3º lugar é excluído** (não conta, não tem
palpite).

| Estágio (API)     | Confronto      | Jogos | Tamanho do grupo | Nº de grupos |
| ----------------- | -------------- | ----- | ---------------- | ------------ |
| `LAST_32`         | 16avos         | 16    | 4                | 4            |
| `LAST_16`         | Oitavas        | 8     | 4                | 2            |
| `QUARTER_FINALS`  | Quartas        | 4     | 2                | 2            |
| `SEMI_FINALS`     | Semifinal      | 2     | 2                | 1            |
| `FINAL`           | Final          | 1     | 1                | 1            |
| `THIRD_PLACE`     | 3º lugar       | 1     | — (excluído)     | 0            |

**Total: 10 grupos de palpite, 31 jogos.**

A Final ser um grupo isolado de 1 jogo é proposital: **cravar o campeão = acertar
o vencedor da Final**, o que casa com o desempate final.

> ⚠️ **Risco a confirmar na implementação:** o nome exato do estágio do *round of
> 32* na football-data.org (provavelmente `LAST_32`; em Copas de 32 times era
> `LAST_16` o primeiro). O mapa de estágios fica numa constante única e
> configurável, com um teste que valida que os 10 grupos se formam a partir das
> fixtures reais seedadas. Se a API usar outro rótulo, muda-se só a constante.

## 3. Conceito unificador: `PickGroup`

Uma função pura `buildPickGroups(matches)` (`src/lib/groups.ts`) transforma a lista
de partidas numa lista ordenada de grupos de palpite, válida pras duas fases:

```ts
type PickGroup = {
  key: string            // "g:2026-06-13"  |  "k:LAST_32:1"
  phase: 'group' | 'knockout'
  label: string          // "Match Day 5"   |  "16avos · Grupo 1" … "Final"
  order: number          // ordenação global (por kickoff/data)
  matchIds: string[]
  teams: string[]        // times não-TBD jogando no grupo
}
// deadline do grupo = menor kickoff entre os jogos do grupo
```

- **Fase de grupos:** 1 `PickGroup` por Match Day. `key = "g:<matchDate>"`,
  `label = "Match Day N"`. Comportamento idêntico ao atual.
- **Mata-mata:** estágio → ordena por kickoff → fatia pelo tamanho da tabela.
  `key = "k:<stage>:<i>"`, label legível por estágio. Exclui `THIRD_PLACE`.

`buildPickGroups` é o coração testável da feature. O resto consome a lista.

## 4. Regra de sobrevivência (consciente da fase)

- **Fase de grupos:** `teamSurvives(match, team)` atual — **venceu ou empatou**
  (pênaltis ignorados).
- **Mata-mata:** `teamAdvanced(match, team)` — o time **avançou**:
  - venceu no tempo normal/prorrogação (`fullTime` próprio > adversário), **ou**
  - empatou no `fullTime` **e venceu nos pênaltis** (`penalties` próprio >
    adversário).
  - Empate no `fullTime` + derrota nos pênaltis = **não avançou** → perde vida.
  - Empate no `fullTime` **sem pênaltis registrados** = **pendente** (não settla
    ainda).

### Dado novo: pênaltis

- `matches`: adicionar `homePenalties`, `awayPenalties` (`integer`, nullable).
- `football-data.ts` (`mapApiMatch`): capturar `score.penalties.home/away`.
- Admin: inputs opcionais de pênaltis pra jogos de mata-mata (ver §8).

## 5. Vidas, `no_options` e eliminação

- **3 vidas**, carregadas da fase de grupos (não resetam). Falhar num grupo (de
  qualquer fase) = **−1 vida**; zerou = fora.
- **`no_options` (só mata-mata):** no settlement de um grupo do mata-mata, se o
  participante está vivo, **não palpitou**, e **todos os times do grupo já foram
  usados por ele no mata-mata**, então ele é **eliminado na hora**, independente
  de vidas restantes.
- Sem palpite mas **com time elegível disponível** → `no_pick` normal (−1 vida).

### Modelo de dados

`life_losses` passa a registrar eventos por **grupo** e ganha o motivo
`no_options`:

- novo motivo no enum: `'lost' | 'no_pick' | 'no_options'`.
- `computeStanding` muda a assinatura de `lossDates: string[]` para
  `events: { date: string; reason: Reason }[]` e passa a calcular:
  - `lives = max(0, 3 − nº de eventos 'lost'|'no_pick')`
  - `eliminatedDate` = a **mais antiga** entre: a data do 3º evento de vida
    perdida (zerou) e a data do evento `no_options` mais antigo.
  - `eliminated = eliminatedDate !== null`.
  - (Um evento `no_options` **não** desconta vida — apenas elimina.)

## 6. Vencedor / desempate final

`decideWinners` é estendida. Quando o torneio acaba, entre os **vivos**:

1. **Cravou o campeão** (pick do grupo da Final == vencedor da Final) → ganha,
   **ignorando vidas**. Se mais de um cravou → dividem.
2. Senão → **mais vidas** vence (empate → dividem).
3. Se **ninguém vivo** (todos eliminados) → regra atual: eliminados **na data mais
   recente** dividem.

Nova assinatura (esboço):

```ts
decideWinners(input: {
  participants: { id: string; eliminated: boolean; eliminatedDate: string | null;
                  lives: number; finalPick: string | null }[]
  championTeam: string | null   // vencedor da Final; null até decidir
  tournamentOver: boolean
}): string[]
```

`tournamentOver` mantém o gatilho atual (todas as partidas FINISHED **ou**
`aliveCount <= 1`). Se acabar por `aliveCount <= 1` antes da Final, `championTeam`
é `null` → cai direto no critério de vidas (com 1 vivo, é ele).

## 7. Settlement (cron)

Reescrever o loop de `src/app/api/cron/settle/route.ts`: em vez de iterar
`datesInclusive` por dia, iterar sobre os **`PickGroup`s** com deadline passado,
aplicando a regra da fase de cada grupo. `settleDay` vira `settleGroup`
(consciente da fase), recebendo: jogos do grupo, picks do grupo (por `groupKey`),
deadline passado, e — no mata-mata — a lista de times já usados por participante
(pra detectar `no_options`). Idempotência preservada via unique
`(participant, groupKey)` em `life_losses`.

## 8. Schema e migração (dados ao vivo — Copa em andamento)

A Copa já começou (11/jun), então há picks/life_losses reais da fase de grupos. A
migração **preserva** tudo.

- **`picks`**: + `groupKey text not null`. Trocar unique `one_pick_per_day
  (participant, matchDate)` por `one_pick_per_group (participant, groupKey)`.
  Manter `no_repeat_team_phase (participant, team, phase)`. Manter `matchDate`
  (= data do jogo do time escolhido, pra ordenação/exibição).
- **`life_losses`**: + `groupKey text not null`. Trocar unique
  `one_loss_per_day` por `one_loss_per_group (participant, groupKey)`. Enum
  `reason` aceita `no_options`. Manter `matchDate` (data representativa do grupo).
- **`matches`**: + `homePenalties`, `awayPenalties` (integer nullable).
- **Backfill:** para rows existentes (fase de grupos), `groupKey = matchDate`.
  Resultado: comportamento da fase de grupos idêntico ao atual.

Plano de migração seguro: adicionar coluna nullable → backfill `groupKey =
matchDate` → tornar `not null` → trocar as unique constraints.

## 9. UI

- **Dashboard (`getSchedule` / `page.tsx`):** agrupar por `PickGroup` em vez de
  por `matchDate`. No mata-mata: rótulo do grupo ("16avos · Grupo 1"), os jogos,
  o deadline, e o formulário pra escolher 1 dos times do grupo. A trava
  anti-repetição reusa `teamsUsedByPhase.knockout` (já existe). Se o participante
  está vivo e **sem time elegível** no grupo → aviso de "sem opções / eliminado"
  no lugar do form.
- **Resultados (`getResults` / `resultados/page.tsx`):** mesma agregação por
  grupo; no mata-mata o desfecho é **"classificou ✅ / eliminado 💀"** (via
  `teamAdvanced`), com o placar (e pênaltis quando houver).
- **Admin (`AdminPanel` / `overrideResult`):** inputs **opcionais** de pênaltis
  pros jogos (úteis em mata-mata empatado). `overrideResult` aceita
  `homePenalties?/awayPenalties?`.

## 10. Testes

Puros e determinísticos:

- `buildPickGroups`: estrutura 4/4/2/2/1, exclusão do 3º lugar, rótulos, ordem;
  validação contra as fixtures reais seedadas.
- `teamAdvanced`: vitória normal, empate+pênaltis (avança/cai), pendente sem
  pênaltis.
- `settleGroup`: fase de grupos (mantém empate-salva), mata-mata (classificou),
  `no_pick`, `no_options`.
- `computeStanding`: contagem de vidas, zerar, `no_options` elimina na hora,
  data de eliminação correta.
- `decideWinners`: campeão > vidas > último eliminado; empates dividem.
- Validação de palpite por grupo (não-repetição no mata-mata).

## 11. Fora de escopo (vai pro spec irmão)

- **Projeção do chaveamento** a partir das classificações dos grupos (prévia dos
  confrontos antes da API preencher os times). Tratado em
  `2026-06-25-knockout-bracket-projection-design.md`. A mecânica deste spec
  funciona com os times que a API já tiver preenchido, sem depender da projeção.
