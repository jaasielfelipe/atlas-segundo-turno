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

## 16/10/2026 — experimentos de corrida e mosaico (replay real do 1º turno)

- **Faixa:** todos os municípios encerrados entram, uma vez cada, em ordem de encerramento; a faixa acelera até 2× com fila (sem descarte).
- **Corrida (`/prototipo/corrida`):** (A) serpentina longa, 8 retas de ~1.740 px (~14,6 mil px de pista, ~2,7× a do 1º turno; ~1 px a cada 6 mil votos); (B) câmera que segue o líder a 3×, com o outro corredor como marcador na borda e minimapa — enquadrar os dois anulava o zoom quando a diferença passava de alguns milhões; (C) cabo de guerra da divisão entre os dois (50% ± 15 p.p.) com rastro. Meta ajustada = (aptos − abstenções apuradas − não válidos apurados) / 2, a partir dos campos acrescentados ao replay.
- **Mosaico (`/prototipo/mosaico`):** cada UF é um “copo” — largura = aptos, altura preenchida = seções apuradas, cores = válidos apurados, traço = metade dos válidos; um único número por UF (vantagem do líder em p.p., na cor do líder, tamanho pela largura); regiões com vantagem e % apurado.
- Verificações: typecheck, testes (geometria da pista, somas nacionais e por UF, larguras, fila única), build, formatação; capturas 1920×1080 sem erro de página.

## 16/10/2026 — mosaico de tamanho fixo e fantasmas do 1º turno na corrida

- **Mosaico:** larguras dependiam do cabeçalho das regiões (números mudando empurravam as colunas). Agora cada região tem a largura exata das suas colunas; medição automática confirma larguras idênticas do início ao fim do replay. Composição em faixas horizontais sobre o eleitorado inteiro da UF: Flávio, Lula, demais (1º turno), brancos e nulos, ausentes; topo vazio = não apurado. Área = eleitores aptos.
- **Corrida:** câmera (peça principal, 4×) + pista inteira em painel próprio. Fantasma por faixa: o mesmo candidato com votos do 1º turno nas mesmas município–zonas (não cronológico). Três regras comparadas: (a) só zonas encerradas — enviesada, porque zonas ainda abertas ficam fora (com 17% apurado indicava “+3 mi” para os dois); (b) proporcional às seções — estimativa; (c) **troca exata**: apuração atual com as zonas encerradas trocadas pelo seu resultado no 1º turno — sem estimativa, e a distância ao corredor é a diferença exata nessas zonas. (c) é o padrão.
- O 2º turno da página de corrida é **sintético** (votos dos demais candidatos divididos entre os finalistas por fração fixa por município), rotulado na tela; os fantasmas usam o 1º turno real.
- Verificações: typecheck, testes (fantasmas nas três regras, 2º turno sintético), capturas sem erro de página.

## 16/10/2026 — mosaico em três cores e efeito de vitória

- **Mosaico:** só Flávio e Lula, como fração dos aptos da UF, empilhados de baixo; o restante da caixa é o resto dos aptos (demais, brancos, nulos, ausentes, não apurado). Larguras calculadas a partir da largura medida do painel (antes, pixels fixos para 1920 estouravam em telas com escala). Medido: 28 colunas visíveis sem rolagem em 1920×1080 e 1366×768. Fontes menores.
- **Vitória matemática na corrida:** regra `victor` — um finalista passa da metade do maior total de válidos ainda possível (aptos − abstenções apuradas − não válidos apurados), o mesmo ponto em que cruza a meta ajustada na pista; teste com metade exata (não é maioria). Efeito: câmera se aproxima do vencedor (1 s), três explosões de partículas na cor dele, faixa e cabeça pulsando, letreiro “Vitória matemática” que vira selo após 7 s; nada disso com `prefers-reduced-motion`. Botões “Ir para a vitória” (salta para 40 s antes do cruzamento) e “Repetir efeito”. No 2º turno sintético, a vitória ocorre com 98,2% das seções. O protótipo não usa nome real no letreiro (dados sintéticos).
- Verificações: typecheck, testes, build, formatação; capturas de entrada, explosão e selo sem erro de página.

## 16/10/2026 — telão completo e ensaio oficial do 2º turno

- **Coleta:** nova coluna `counted_electorate` (EA20 `e.est`, migration 004) para as abstenções apuradas por zona; base do 1º turno migra sem perda (campo nulo, não usado).
- **Ensaio oficial do 2º turno** (pré-votação, 17/10 00:44–00:46 UTC, `TSE_RPS=20`, 120 s): cadastro `30958875da4c` (6.292 segmentos, 6.352 tarefas), 2.232 requisições, 241 × 304, **0 erros**; ~1.400 segmentos observados, todos com 0 seções apuradas (esperado). Agregados oficiais de 29 territórios (Brasil, 27 UFs, exterior) com 0 votos.
- **API** (`pnpm start`, `127.0.0.1:3201`): bootstrap (cadastro, nomes do EA12, tamanhos por segmento, base do 1º turno completa para 6.292 segmentos), boletins incrementais por rowid, agregados oficiais e estado do coletor; testes com arquivos oficiais reais do 2º turno (inclui zona AC 01120/0008 capturada em 16/10) e sem acervo (503).
- **Telão** (`/telao`): placar e corrida pelo agregado oficial BR; mosaico pelos agregados oficiais das UFs; mapa, fluxo e faixa pelas zonas; fantasma = oficial − diferença exata nas zonas encerradas. Palco 1920×1080 escalado: sem rolagem em 1920×1080 e 1366×768; sem erro de página ao vivo e na demonstração (`/telao?demo`, 2º turno sintético rotulado).
- **Não comprovado:** apuração real do 2º turno (a partir de 25/10/2026).

## 16/10/2026 — layout revisto e vitória global

- Boletins por zona em coluna própria no extremo esquerdo; mapa centralizado.
- Mosaico mais baixo e sem números: Lula desce do topo, Flávio sobe da base (frações dos aptos de cada UF); o vazio entre eles é o restante e se fecha com a apuração.
- Pista inteira como peça principal; câmera do líder em janela (picture-in-picture) sobre a parte da pista que nenhum corredor alcança.
- Vitória matemática vira estado do motor e evento do telão inteiro: letreiro central, fogos na cor do vencedor e brilho nas bordas por ~9 s; depois só a marca no placar. `/telao?demo&vitoria` começa a demonstração 30 s antes da vitória sintética.
- Na demonstração, o placar e o letreiro usam “candidatura verde/vermelha” — números sintéticos nunca ao lado de nomes reais.
- Verificações: typecheck, 72 testes, build, formatação; capturas ao vivo (1920×1080 e 1366×768, sem rolagem) e da vitória na demonstração, sem erro de página.

## 16/10/2026 — refinamentos de pista, faixa e mapa

- Pista: sem câmera em janela e sem legenda; os fantasmas já são rotulados. A diferença exata contra o 1º turno nas zonas encerradas (“+X mi vs 1º turno”) passa ao placar, sob os votos de cada candidato. Cabeça de Lula como pequena estrela (segunda pista visual além da cor). Brilho de vitória restrito à faixa do vencedor.
- Faixa de municípios encerrados: 70 px/s constantes, sem aceleração por fila.
- Mapa: cor viva enquanto o município está em apuração; escurece quando todas as seções foram apuradas.
- Verificações: typecheck, 72 testes, build, formatação; capturas ao vivo (1920×1080 e 1366×768) e da demonstração na vitória, sem erro de página.

## 16/10/2026 — experimentos (branch `experimentos`)

- **Superfície do mapa** (`/telao?…&globo`, `&grade`, `&luz`, ou `&superficie` para os três): projeção globo do MapLibre 5 com céu/atmosfera (halo no horizonte), grade cartográfica de 5° gerada localmente, luz direcional mais marcada nas extrusões. Sem tiles nem rede.
- **Pista com chegada pelos válidos** (`&chegada`): a pista inteira vai de 0 à meta ajustada (metade dos válidos ainda possíveis), com a linha de chegada no fim; a escala acompanha a meta, que recua durante a apuração; a vitória matemática coincide com cruzar a chegada e o vencedor para no fim.
- Verificações: typecheck, 72 testes, build, formatação; capturas das cinco variações na demonstração, sem erro de página.
- **Correção (globo):** manchas escuras cintilantes no território — z-fighting entre prismas de altura zero (municípios sem apuração) e a camada de terra no mesmo plano, muito mais visível na projeção globo. Agora só municípios com seções apuradas são extrudados (filtro por id, atualizado em lote) e com altura mínima de 1.500 m. Efeito colateral positivo em todos os modos: divisas municipais e estaduais passam a aparecer na área ainda não apurada. Capturas de quadros consecutivos estáveis em `superficie`, `globo` e `grade`.
- **Atmosfera mais suave** no globo (halo fino; menos mistura de céu e horizonte).
- **Outros continentes** (`&continentes`, incluído em `superficie`): Natural Earth 1:50m land (domínio público), baixado uma vez e versionado com hash em `observation-extra.json`; preenchimento em tom pouco acima do oceano e costa discreta, sob o Brasil e sobre a grade. Tons próprios no globo (oceano mais claro).
- **Mapa como fundo** (`&fundo`): globo com continentes atrás do palco inteiro, Brasil enquadrado na área da antiga coluna do mapa (padding da câmera pelas colunas laterais, zoom +0,25). Painéis transparentes ou com véu leve (cabeçalho e fluxo em degradê, faixa e asfalto da pista semitransparentes, área vazia do mosaico translúcida); dados e textos opacos, com sombra/contorno escuro para leitura sobre o mapa. Capturas sem erro de página.
- **Inclinação corrigida no `fundo`:** o padding da câmera desloca o enquadramento mas, no globo, não o ponto de fuga — o Brasil aparecia visto de lado. Agora a tela do mapa (2500×1088) é centrada na antiga coluna do mapa (centro 670, 544), maior que o palco e cortada por ele, com margens simétricas: mesmo enquadramento, inclinação e zoom da versão em coluna (comparação lado a lado com `&globo&continentes`).
- **Pista mais limpa:** anéis do 1º turno sem rótulo na pista, explicados uma vez na legenda do painel; chegada/meta ajustada em cinza-claro neutro (linha tracejada), sem o amarelo; marcas de votos (mi) com fonte menor e tom apagado, traços mais finos.
- **Sanity check do mosaico (oficial, 158,75 mi de aptos = BR):** as larguras distorciam a proporção — 16 de 28 UFs no mínimo de 18 px (RR até 10,8× a largura proporcional), as grandes a 70% e **inversão**: GO (5,08 mi, 14,7 px) e MA (5,18 mi, 15 px) mais estreitas que MS (2,02 mi, 18 px), porque o algoritmo marcava os estados abaixo do mínimo numa só passada. Corrigido: recálculo até estabilizar (teste com os eleitorados oficiais: ninguém abaixo do mínimo, nenhum maior mais estreito que um menor) e mínimo de 8 px. Medido de novo: UFs grandes e médias a 95–96% da largura proporcional; só RO, TO, AC, AP, RR, SE e exterior no mínimo; siglas verticais nas colunas estreitas.
- **Faixa sem saltos:** ao sair o primeiro item, a posição era corrigida num quadro diferente daquele em que o React removia o item (salto de uma largura de item). Agora a correção roda num efeito de layout, no mesmo quadro, antes da pintura. Medido: 600 quadros, 6 saídas, 0 recuos (antes: 30 recuos de até 457 px). O delta passa a ser dito no item: “▲ 0,7 vs 1º turno”.
- **Mosaico:** siglas com altura fixa (as verticais encurtavam as barras); medido: todas as barras com 213 px. Legenda removida.
- **Pista:** legenda dos fantasmas acima da pista.
- **Faixa em duas linhas:** cidade em branco; abaixo, “FF% vs LL%” e **ΔT1 +XX** — o maior ganho de participação nos válidos do 1º para o 2º turno entre os dois finalistas, na cor de quem ganhou mais (independe de quem lidera; teste: Flávio lidera 45→52 e Lula ganha mais 40→48 → ΔT1 vermelho +8).
- **Mosaico:** todas as siglas giradas 90°, mesma altura; barras iguais (208 px medidos).

## 17/10/2026 — mosaico fecha no fim da apuração (sintético)

- Altura das barras por UF = votos ÷ (aptos − abstenções apuradas − não válidos apurados), o maior total de válidos ainda possível (mesma base da meta ajustada da pista). Antes o divisor era o total de aptos, e abstenções/brancos/nulos (~25%) ficavam sempre vazios.
- Função pura `bars()` em `apps/web/src/prototype/mosaic.ts`, com teste (fim = 100%; meio = vazio igual aos aptos não apurados).
- Replay até o fim, **2º turno sintético**: Flávio + Lula = 100,0% em todas as UFs (BA e MG 99,9% por arredondamento). Com os votos reais do 1º turno a soma fica entre 85% e 95%, como esperado, porque os demais candidatos não aparecem.
- typecheck, test (75), build e format:check com código 0; revisão visual na vitória do demo: há vazio só nas UFs com seções a apurar.

## 17/10/2026 — revisão do caminho ao vivo contra o formato oficial do TSE

Escopo: o que até agora só tinha sido exercitado com o 2º turno sintético. Evidências: acervo oficial do 1º turno (real), ensaio oficial pré-votação do 2º turno (real, zerado) e contagens **sintéticas** preenchidas sobre arquivos reais do 2º turno (teste de API).

- **Abstenção no ao vivo ≠ demo (corrigido).** O ao vivo usava `esi − c` (só seções instaladas); o demo, `est − c`. No 1º turno real o exterior teve 423 eleitores em seções não instaladas (`est − esi`). Com `esi`, o mosaico do exterior nunca fecharia e a meta da vitória ficaria ~211 votos acima. Agora as duas usam `est − c`: maior total de válidos possível = válidos apurados + `te − est`. No 1º turno real, ao fim, `te = est` em todas as 29 abrangências.
- **Destinação dos votos.** No pré-votação do 2º turno os candidatos vêm sem `dvt`; no 1º turno real o campo virou “Válido” exatamente quando a apuração começou. Defesa nova: num turno de dois candidatos, Flávio + Lula tem de ser igual a `vv`. Arquivo de zona que não fecha não é desenhado. Agregado que não fecha cede lugar à versão consistente mais recente (até 10 para trás), lida do banco, e sobrevive a reinício. O status conta os casos e o cabeçalho avisa. O placar só soma votos com destinação “Válido”, como nas zonas.
- **Tamanhos dos segmentos.** As seções por segmento são iguais entre os turnos (1.931 segmentos comparados). O eleitorado muda um pouco em 1.315 deles (atualização do cadastro). O cache do servidor fixava os tamanhos do 1º turno para os segmentos ainda sem versão do 2º. Agora o bootstrap é refeito quando um segmento recebe a primeira versão; na prática, só durante a primeira varredura, antes do fechamento das urnas. No 1º turno real nenhum segmento mudou de total de seções nem regrediu em seções apuradas.
- **Sondagem de eventos.** Uma consulta por vez (antes podiam se sobrepor), paginada até alcançar o fim (sinal `more` do servidor). A consulta usa o intervalo de `rowid`: 0,9 ms em regime contra 5,4 ms; carga completa de 28 mil versões em ~0,5 s. Agregados oficiais: 40 ms sobre 7 mil snapshots.
- **Cobertura.** 6.292 segmentos no cadastro do 2º turno, todos com base do 1º turno, todos com nome e tamanho.
- **Cabeçalho.** O delta “vs 1º turno” fica ausente (não “+0”) até alguma unidade encerrar.
- **Testes.** API com votos sobre arquivos reais do 2º turno com contagens sintéticas (eventos, abstenção com seções não instaladas, versões inconsistentes); vitória no caso limite de empate ainda possível. 77 testes; typecheck, build e format:check com código 0. Revisão visual no ao vivo pré-votação e no demo (`?globo&grade&chegada`), sem erros de página.
- **Não comprovado:** arquivos reais do 2º turno com votos (só a partir de 25/10). O simulado do TSE de 14/09 tinha só o 1º turno; o servidor do telão lê apenas o ambiente oficial.
