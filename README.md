# Atlas do 2º Turno

Telão **local** (`127.0.0.1`) para acompanhar ao vivo a apuração do **2º turno presidencial de 25/10/2026** — Flávio Bolsonaro × Lula — e comparar, **nas mesmas zonas eleitorais**, o 2º turno com o 1º, a partir dos arquivos públicos de divulgação do TSE.

**Telão:** `pnpm build && pnpm start` → <http://127.0.0.1:3201/telao> (dados oficiais coletados por `pnpm collect:official:live`). Demonstração com 2º turno sintético: `/telao?demo`. Passo a passo do dia: [docs/OPERACAO.md](docs/OPERACAO.md).

Placar oficial (EA20 Brasil), mapa 3D por município que se pinta durante a apuração, corrida em serpentina com câmera, fantasmas do 1º turno nas mesmas zonas e efeito de vitória matemática, mosaico das UFs por região, fluxo de boletins por zona e faixa de municípios encerrados.

## Requisitos e verificação

Git, Node.js 22.12+ (validado com 24.19), pnpm 11.19.0.

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test     # sem rede; só fixtures
```

## Dados

| Comando | O que faz | Rede |
|---|---|---|
| `pnpm baseline:round1 [banco.sqlite]` | Base do 1º turno a partir do acervo oficial de 04/10 do projeto anterior (padrão `../ele2026/data/official/collection.sqlite`) | não |
| `pnpm baseline:refresh` | Recaptura segmentos do 1º turno ainda não concluídos na base (≤ 2 req/s) | sim, poucos arquivos |
| `pnpm collect:official:live` | Coleta contínua do 2º turno (até 80 req/s, rampa), dados em `data/official/round2/` | sim — **um coletor por máquina/IP** |
| `pnpm build` · `pnpm start` | Compila e serve o telão em `127.0.0.1:3201` | não |
| `pnpm backup [official\|baseline]` | Cópia SQLite consistente | não |
| `pnpm prototype:data` + `pnpm dev:web` | Protótipos com o replay real do 1º turno: <http://127.0.0.1:5373/prototipo/mapa>, `/prototipo/corrida`, `/prototipo/mosaico` | não |

Regras do projeto: [AGENTS.md](AGENTS.md). Especificação: [docs/ESPECIFICACAO.md](docs/ESPECIFICACAO.md). Evidências: [docs/VALIDACAO.md](docs/VALIDACAO.md).

## Estrutura

- `packages/tse` — descoberta EA11 por turno, schemas, URLs, validação, coletor com teto de taxa.
- `packages/domain` — tipos e `compareRounds` (1º × 2º turno nas mesmas unidades).
- `apps/api` — SQLite (migrations, zonas por turno), coleta nacional, base do 1º turno.
- `packages/fixtures` — capturas TSE com hashes (1º turno, 2º turno pré-votação, simulado), malhas IBGE.

Derivado de [atlas-da-apuracao](https://github.com/jaasielfelipe/atlas-da-apuracao) (painel do 1º turno). Fontes: [documentação técnica TSE](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados).
