# Registro de validação

Append-only. Separar sempre: sintético (fixture), simulado TSE, oficial TSE.

## 16/10/2026 — fundação

**Oficial, observação pré-votação do 2º turno** (4 requisições únicas, `packages/fixtures/round2/observation.json`):

- EA11 gerado em 15/10/2026 09:35:49 contém o pleito **3221** (25/10/2026) com a eleição presidencial **6258**, turno 2 (e 6260, governador, fora do escopo). Simulado TSE ainda sem 2º turno.
- EA12 de 6258: **6.292 segmentos, conjunto idêntico** ao EA12 de 6257; 499.248 seções no EA20 nacional.
- EA20 nacional de 6258: apenas Flávio (`280002551544`, 22) e Lula (`280002542548`, 13), com os mesmos `sqcand` do 1º turno; contadores zerados.

**Base do 1º turno** (`docs/evidence/baseline-round1.json`):

- Construída sem rede a partir do acervo oficial de 04/10 (projeto anterior): 6.292/6.292 segmentos, corpos verificados por SHA-256, cadastro igual ao EA12 oficial do 1º turno. Na primeira passagem: 6.239 concluídos, 12 parciais, 41 em revisão; soma 69 seções abaixo do agregado nacional.
- Diagnóstico dos 12 parciais: o coletor de 04–05/10 consultou cada um a cada ~2 min até 09:14 UTC de 05/10 e recebeu 304 (arquivo zonal do TSE sem atualização), enquanto o agregado nacional já estava em 100%. Uma consulta em 16/10 mostrou o arquivo atualizado pelo TSE às 12:53 de 05/10.
- `baseline:refresh` (53 requisições sequenciais, ≥ 500 ms): 12 parciais → concluídos; 41 continuam em revisão — todos na **zona do exterior**, seções não instaladas e 0 votos.
- Resultado: soma dos 6.292 segmentos **igual** ao agregado nacional oficial (05/10 06:00 UTC) em seções, eleitorado, comparecimento, válidos, brancos, nulos, Flávio e Lula.

**Sintético:** `compareRounds` com casos de zona inteira, unidade município–zona, exclusões (pendente, revisão, cadastro diferente, 1º turno incompleto), sem informação futura, categorias fechando no eleitorado, matriz de liderança, coorte vazia com participações `null`. Typecheck e 58 testes passaram (inclui reconstrução da base a partir de acervo mínimo no formato anterior e rejeição de corpo adulterado).

**Não comprovado:** coleta e comparação do 2º turno com resultados reais (o TSE publica a partir de 25/10).

## 16/10/2026 — protótipo do mapa por município (replay real do 1º turno)

`pnpm prototype:data` gera, a partir do acervo oficial de 04/10 (só leitura), a malha IBGE de 5.570 municípios ligada ao código TSE (falta só Boa Esperança do Norte/MT, criado em 2025 e ausente da malha) e o replay de 28.314 versões de 6.292 segmentos. `/prototipo/mapa`: municípios em 3D (MapLibre `fill-extrusion`), altura animada pela vantagem do líder (três escalas), cor escura em apuração e cheia quando encerrado, clarão no boletim, feed com fila e ritmo.

- Limite do replay: o acervo só tem a apuração a partir de 19:20 de 04/10 (75% das seções), porque o computador suspendeu antes; o início da noite não pode ser revisto com dados reais.
- Ritmo medido de boletins (arquivo zonal com seções novas): 21.612 na noite; pico 1.295/min, p90 235/min, mediana 20/min — base do feed com fila (um card a cada 0,9 s; prioridade a encerramentos e maiores boletins; contador do último minuto).
- Verificações: typecheck, 61 testes (motor do replay, fila do feed), build, formatação; capturas 1920×1080 sem erro de página (Edge/SwiftShader).

## 16/10/2026 — estados em grupo no replay: artefato de captura; dois feeds

- **Diagnóstico:** no replay por horário de captura, as UFs “acendiam” em grupo. O acervo mostra que, ao retomar às 19:20 de 04/10, o coletor percorreu a fila em ordem alfabética de chave (MG, MS, MT, PA… depois AC, AP, BA…), ~6,5 min com a rampa. Não é a ordem de publicação do TSE.
- **Replay:** passa a usar o horário de geração gravado pelo TSE em cada arquivo (`dg`/`hg`), monotônico por segmento. Primeira seção apurada às 17:20:29; UFs intercaladas. Limite: zonas que mudaram várias vezes antes das 19:20 aparecem só com o último estado anterior à retomada.
- **Coleta do 2º turno:** o último desempate da fila deixa de ser a chave em ordem alfabética e passa a ser um hash estável (FNV-1a) da chave; prioridades, prazos e equidade inalterados. Teste: 12 UFs não saem em ordem alfabética.
- **Feeds:** (1) boletins por zona — todos, em fluxo rápido, com contagem do último minuto por cor; (2) municípios encerrados — fila com ritmo (1,8 s), maiores e mais recentes primeiro, com resultado final do município. O motor marca o boletim exato que encerra cada município.
- Verificações: typecheck, 62 testes, capturas sem erro de página.

## 16/10/2026 — faixa de municípios encerrados e fluxo discreto

- Municípios encerrados viram faixa horizontal (ticker) na base: nome na cor do líder, % de Flávio e de Lula nos válidos nas cores de cada um, ▲ variação da margem vs 1º turno na cor de quem ganhou margem. Itens entram só quando a cauda chega à borda; com fila, maiores municípios (seções) primeiro.
- **Delta sintético no protótipo:** o replay é o próprio 1º turno; a variação exibida é um valor determinístico por município (−8…+8 p.p.), com selo “Δ sintético · demonstração”. No 2º turno o campo vem da base do 1º turno.
- Boletins por zona: fonte menor, só o número na cor do candidato (sem rótulos F/L).
- Verificações: typecheck, 62 testes, build, formatação; captura 1920×1080 e teste de fumaça da faixa sem erro de página.
