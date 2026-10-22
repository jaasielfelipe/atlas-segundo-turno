# AGENTS.md — Atlas do 2º Turno

Instruções para agentes neste repositório. Fonte funcional: [docs/ESPECIFICACAO.md](docs/ESPECIFICACAO.md). Evidências: [docs/VALIDACAO.md](docs/VALIDACAO.md).

## Objetivo

Telão local ao vivo do 2º turno presidencial (25/10/2026) comparando o 2º turno com o 1º nas mesmas zonas eleitorais. Presidente apenas. Origem: núcleo de coleta do projeto “Atlas da Apuração” (1º turno, `jaasielfelipe/atlas-da-apuracao`), copiado sem histórico git.

## Regras inegociáveis

1. Local, usuário único, `127.0.0.1` por padrão (`ATLAS_API_HOST` só para servidor atrás de proxy reverso/contêiner, decisão de 21/10/2026). Sem contas, nuvem, Docker obrigatório, PostgreSQL ou Redis. Stack: React/Vite/TypeScript, Node/Fastify, SQLite WAL, Vitest, Playwright. Justificar qualquer biblioteca nova.
2. TSE é a fonte primária. Descobrir pelo EA11; validar fase, eleição, **turno**, cargo, abrangência, origem e identificadores em cada arquivo.
3. Simulado/fixture nunca apresentado como oficial; `f=s` na rota oficial é falha.
4. Um coletor TSE por máquina/IP; teto 80 req/s (304 conta). Sem loops de 404. Coleta só com pedido explícito do usuário.
5. Snapshots e versões imutáveis; replay pela última versão até o instante; sem interpolação nem informação futura.
6. Zero ≠ ausente. IDs territoriais são texto.
7. Comparação só em unidades concluídas nos **dois** turnos com o mesmo cadastro; Brasil/UF contam zonas inteiras, município conta unidades município–zona. Somas de votos, nunca médias de percentuais.
8. Finalistas por `sqcand` oficial (`packages/fixtures/round2/finalists.json`), nunca por nome.
9. **Sem transferência de votos** inferida ou sugerida, sem previsão, probabilidade, narrativa ou avaliação política. Balanço por categoria é contábil e deve ser rotulado assim. Fatos aritméticos só quando garantidos.
10. Placar sempre do agregado oficial EA20; zonas nunca substituem o total Brasil/UF.

## Método

- Funções puras para métricas (`packages/domain`), com testes que incluam falhas.
- Antes de declarar pronto: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format:check` (e E2E quando houver UI) com **código de saída** verificado; revisão visual quando houver UI.
- Registrar em `docs/VALIDACAO.md`, separando sintético, simulado e oficial. Não declarar coleta oficial do 2º turno validada sem acervo real de 25/10.
- Processos de longa duração (coletor, servidor do telão) são abertos pelo usuário em terminal próprio; os abertos pelo agente morrem com a sessão.

## Decisões do usuário

- 16/10/2026: escopo “apenas presidente”; uso “telão ao vivo”; referência “primeiro turno vs segundo turno” (sem 2018/2022); repositório público.
- 17/10/2026: layout preferido como padrão do telão — globo, grade, continentes, mapa de fundo e chegada nos válidos (`apps/web/src/telao/layout.ts`); `?classico` mantém a v1.0.
- 21/10/2026: o host do servidor pode ser definido por `ATLAS_API_HOST` (pedido para hospedar em VPS); o padrão continua `127.0.0.1`. A API não tem autenticação: fora da máquina local, expor só via proxy reverso/firewall.
- Herdadas do 1º turno: taxa de 80 req/s; cores Lula = vermelho, Flávio = verde (por identidade, validadas para daltonismo); fatos aritméticos permitidos quando garantidos pelos números publicados.

## Estado — 17/10/2026 (`v1.1-telao-2t`)

Telão em `/telao` (servidor `apps/api`, cliente `apps/web/src/telao`). Layout padrão: globo com grade e continentes ao fundo de todo o palco; mapa 3D por município (altura = vantagem em votos, √; vivo em apuração, escuro encerrado); fluxo discreto de zonas; faixa de municípios encerrados em duas linhas com ΔT1; pista inteira com chegada nos válidos ainda possíveis e fantasma por **troca exata**; mosaico de largura fixa pelos aptos, com barras sobre o maior total de válidos possível (fecha no fim). `?classico` = v1.0. Caminho ao vivo revisado contra o formato oficial (abstenção por `est − c`, votos dos finalistas = válidos, versão consistente mais recente). Ensaio oficial pré-votação: 2.232 requisições, 0 erros. Guia do dia: [docs/OPERACAO.md](docs/OPERACAO.md). **Não comprovado:** arquivos reais do 2º turno com votos (a partir de 25/10).
