# Operação — 2º turno, 25/10/2026

Telão local (`127.0.0.1`), um único computador. Regras: [../AGENTS.md](../AGENTS.md).

## Uma vez, antes do dia

```powershell
pnpm install --frozen-lockfile
pnpm data:1t               # base do 1º turno + replay da demonstração (antes do build)
pnpm build                 # typecheck + geometria + web + servidor
pnpm test
```

Base do 1º turno (fantasmas e “margem vs 1º turno”): `data/baseline/round1.sqlite`. Em outra máquina: `pnpm data:1t` **antes** do `pnpm build` (baixa a base e o replay da demonstração da release `dados-1t-v1` e confere os hashes). Quem tem o acervo do 1º turno pode reconstruí-la com `pnpm baseline:round1 <acervo>` e `pnpm baseline:refresh`. Sem a base, o telão funciona sem fantasmas e o fluxo mostra a margem do boletim em votos.

## No dia (a partir de ~16h30; urnas fecham às 17h de Brasília)

Computador **na tomada, sem suspensão**. Dois terminais abertos por você (processos abertos por um agente morrem com a sessão dele):

```powershell
# Terminal 1 — coletor oficial do 2º turno (até 80 req/s, rampa a partir de 10)
pnpm collect:official:live
# Terminal 2 — servidor do telão
pnpm start                 # http://127.0.0.1:3201/telao
```

- Abrir `http://127.0.0.1:3201/telao` em tela cheia (F11). Layout padrão: globo com grade e continentes, mapa ao fundo, pista com chegada nos válidos ainda possíveis. `?classico` volta ao layout da v1.0 (mapa plano na coluna, linha fixa de 50% dos aptos). Selo **OFICIAL TSE** no topo; ponto verde “coletando”.
- Um coletor por máquina/IP: o lock fica em `~/.atlas-tse/active.lock` (vale para qualquer cópia do repositório). Nunca rodar o coletor do 1º turno ou do simulado junto.
- Status a cada 10 s no terminal 1 e em `data/official/round2/collector-status.json`.
- `pnpm backup official` a cada hora (seguro com o coletor rodando).

## O que o telão mostra e de onde vem

| Peça                                                    | Fonte                                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Placar, % de seções, corrida, vitória matemática        | Agregado oficial EA20 Brasil                                                      |
| Mosaico por região                                      | Agregados oficiais EA20 de cada UF e do exterior                                  |
| Mapa por município, fluxo de zonas, faixa de encerrados | Arquivos EA20 de cada município–zona (soma exata dos segmentos de cada município) |
| Fantasmas e “margem vs 1º turno”                        | Mesmas município–zonas na base do 1º turno                                        |

Vitória matemática: só quando um finalista passa da metade do maior total de válidos ainda possível (válidos apurados + eleitorado das seções ainda não apuradas; eleitores de seções não instaladas contam como ausentes) — o ponto em que cruza a meta ajustada na pista. Nenhum resultado das seções restantes muda o vencedor a partir daí; o letreiro informa que o resultado oficial é do TSE.

## Em servidor (VPS)

`ATLAS_API_HOST` muda o endereço de escuta (padrão `127.0.0.1`), por exemplo `ATLAS_API_HOST=0.0.0.0` dentro de um contêiner. A API não tem autenticação: na VPS, prefira manter `127.0.0.1` com nginx/Caddy na frente, ou limite a porta 3201 no firewall. Um coletor por IP continua valendo.

## Incidentes

- **Rodapé do cabeçalho com “arquivo(s) inconsistente(s) não exibido(s)”:** arquivos em que os votos dos dois finalistas não somam os válidos (destinação ausente ou alterada). O telão mantém a última versão consistente de cada território e não desenha a inconsistente. Anotar o horário; não exige ação imediata.

- **403/429:** o coletor pausa ≥ 10 min sozinho e volta em rampa. Se repetir, reiniciar com `$env:TSE_RPS=40; pnpm collect:official:live`.
- **Coletor caiu / computador reiniciou:** rodar de novo `pnpm collect:official:live`; ele retoma do banco.
- **Telão com aviso de erro:** o servidor continua; recarregar a página (F5) refaz tudo a partir do banco.
- **Cadastro do TSE mudou** (`FALHA: Banco/eleição/cadastro incompatível`): parar, `pnpm backup official`, mover `data/official/round2/` e reiniciar; zonas com cadastro diferente saem da comparação com o 1º turno.

## Demonstração

`http://127.0.0.1:3201/telao?demo` (exige o replay: `pnpm data:1t` antes do build, ou `pnpm prototype:data` com o acervo do 1º turno): o replay real do 1º turno convertido em **2º turno sintético**, com selo de demonstração. Nunca usar como resultado.
