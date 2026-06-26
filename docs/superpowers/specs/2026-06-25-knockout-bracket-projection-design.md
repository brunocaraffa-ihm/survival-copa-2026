# Mata-mata — Projeção do Chaveamento (Prévia dos Confrontos)

**Data:** 2026-06-25
**Autor:** Bruno Caraffa
**Status:** Aprovado (design)
**Spec irmão:** `2026-06-25-knockout-pick-mechanics-design.md` (Mecânica — etapa 1)
**Ordem:** implementar **depois** da etapa 1.

## 1. Visão geral

Mostrar uma **prévia do chaveamento do mata-mata** com base nos **resultados
atuais** da fase de grupos, **antes** da API preencher os times oficiais. A
projeção calcula a classificação de cada grupo a partir dos **placares que já
guardamos no banco**, monta os 16avos prováveis e renderiza o bracket. Rodadas
seguintes (oitavas em diante) aparecem como "Vencedor de tal confronto", porque
quem avança é justamente o que o bolão chuta.

Tudo marcado como **"projeção não-oficial"**. Conforme os grupos terminam de
verdade, a projeção converge para o oficial (e, quando a API preenche os times,
mostramos o oficial no lugar do projetado).

> Esta etapa é **só de leitura/visualização** — não altera a mecânica de palpites
> nem o settlement do Spec 1.

## 2. Formato da Copa 2026 (premissas)

- **48 times, 12 grupos (A–L) de 4.**
- Classificam-se: **1º e 2º de cada grupo (24)** + **8 melhores 3º colocados**
  → 32 times nos 16avos (`LAST_32`).
- O encaixe dos 8 terceiros nos slots dos 16avos segue a **tabela de combinação
  FIFA** (depende de *quais* grupos produziram os terceiros classificados).

## 3. Componentes

### 3.1 Classificação dos grupos — `computeGroupStandings(matches)`

`src/lib/standings.ts`, função pura sobre os jogos `GROUP_STAGE` já guardados.

- Por grupo: pontos (V=3, E=1), depois **saldo de gols → gols pró → confronto
  direto** entre empatados.
- Ordena 1º→4º.
- **Limitação documentada:** critérios FIFA de *fair play* (cartões) e sorteio
  **não são calculáveis** (não temos dado de cartões). Em empates que só esses
  critérios resolveriam, a projeção usa um tie-break determinístico estável
  (ex.: ordem alfabética) e **sinaliza "indefinido"** na UI.
- Requer saber **a qual grupo cada time pertence**. Como a fixture não traz isso
  explicitamente de forma confiável, manter um mapa **time → grupo** nas
  constantes do torneio (`src/lib/wc2026.ts`), derivado das fixtures dos jogos de
  grupo (os confrontos de grupo definem os grupos).

### 3.2 Ranking dos melhores terceiros — `rankThirdPlaces(standings)`

- Pega o 3º de cada um dos 12 grupos, ranqueia por pontos → saldo → gols pró, e
  seleciona os **8 melhores**.
- Retorna o conjunto de grupos cujos terceiros se classificaram (entrada da
  tabela de combinação).

### 3.3 Constantes do bracket WC2026 — `src/lib/wc2026.ts`

Dados fixos e públicos, **hardcoded e conferidos** (com testes):

- **Mapa time→grupo** (ou derivação a partir das fixtures de grupo).
- **Slots dos 16avos:** quais posições (1A, 2B, 3X…) ocupam cada um dos 16
  confrontos.
- **Tabela de combinação dos terceiros:** dado o conjunto dos 8 grupos que
  classificaram terceiros, em quais slots cada terceiro entra.
- **Propagação do bracket:** como os vencedores dos 16avos se cruzam em oitavas,
  quartas, semi e final (árvore fixa).

> ⚠️ **Risco/efeito principal:** estes dados precisam estar **corretos**. São o
> ponto mais sujeito a erro do spec. Cada artefato ganha teste de unidade
> (ex.: cada slot aparece exatamente uma vez; a tabela cobre as combinações
> possíveis).

### 3.4 Projeção — `projectBracket(matches)`

Compõe os anteriores:

1. `computeGroupStandings` → 1º/2º de cada grupo + lista de terceiros.
2. `rankThirdPlaces` → 8 melhores terceiros + conjunto de grupos.
3. Aplica os slots + tabela de combinação → **confrontos projetados dos 16avos**.
4. Rodadas seguintes → nós "Vencedor de \<confronto\>".
5. **Override pelo oficial:** se a partida real do mata-mata já tem times
   definidos (a API preencheu / não é TBD), usa o oficial e o placar real no
   lugar do projetado.

Saída: estrutura de bracket pronta pra render, com flag `projetado | oficial` por
confronto.

## 4. UI

- Nova tela/seção **"Chaveamento (prévia)"** (ex.: `/chaveamento` ou seção no
  dashboard), read-only.
- Bracket com os 16avos projetados (placar atual quando o jogo já tem resultado),
  e rodadas seguintes como "Vencedor de…".
- Badges: **"projeção não-oficial"** global; por confronto, marca quando é
  projetado vs já oficial; marca posições "indefinidas" por falta de critério.

## 5. Testes

- `computeGroupStandings`: pontos, saldo, gols, confronto direto; empates
  resolvidos de forma estável; cenários de grupo completos e parciais.
- `rankThirdPlaces`: seleção dos 8 melhores; desempate estável.
- Constantes `wc2026`: cada slot único; tabela de combinação completa/consistente;
  árvore de propagação sem buracos.
- `projectBracket`: projeção a partir de standings sintéticos; override pelo
  oficial quando a partida real tem times definidos.

## 6. Dependências

- Depende do schema/dados do Spec 1 estarem no lugar (não estritamente, mas é a
  ordem natural). Não altera settlement nem picks.
- Sem dependência de endpoint novo da API (decisão: calcular dos placares já
  guardados).
