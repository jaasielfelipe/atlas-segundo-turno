# Especificação — Atlas do 2º Turno

Revisão 0.1, 16/10/2026. Fonte funcional e técnica deste repositório. Em conflito com código ou outros documentos, vale esta especificação; decisões do usuário registradas em `AGENTS.md` têm precedência sobre ela.

## 1. Objetivo

Telão **local, de usuário único** (`127.0.0.1`) para acompanhar ao vivo a apuração do **2º turno presidencial de 25/10/2026** (Flávio Bolsonaro × Lula), com uma leitura central: **como o 2º turno se compara ao 1º turno nas mesmas zonas eleitorais**.

Escopo: Presidente apenas. Sem governador, sem histórico de 2018/2022, sem painel explorador.

## 2. Fontes

| Dado | Origem | Estado |
|---|---|---|
| 2º turno ao vivo | EA11 → EA12 → EA20 (agregados e zonas) + EA14/EA15 como pistas, ambiente oficial TSE; pleito **3221**, eleição **6258** | descoberta validada no EA11 de 15/10/2026 (`packages/fixtures/round2/`) |
| 1º turno (base) | EA20 zonal oficial da eleição **6257**, capturado na noite de 04/10/2026 pelo projeto anterior, com 12 segmentos recapturados em 16/10/2026 | congelada em `data/baseline/round1.sqlite`; conciliada com o total nacional oficial (§6) |
| Identidade dos finalistas | `sqcand` oficial nos arquivos EA20 de 6257 e 6258 | Flávio `280002551544` (22), Lula `280002542548` (13) — iguais nos dois turnos |

Cadastro: o EA12 de 6258 tem os **mesmos 6.292 segmentos município–zona** do EA12 de 6257 (verificado por conjunto, não só por digest). Se o TSE publicar cadastro diferente, a zona afetada sai da comparação com status `registry_changed`.

## 3. Unidades e conclusão

- Unidade de coleta: `{eleição, turno, UF, município TSE, zona}`. IDs territoriais são texto (zeros à esquerda preservados).
- Segmento concluído: `ts > 0`, `snt = 0`, `st = ts`, todas as contagens publicadas e consistentes, candidaturas somando os válidos. No 2º turno, exatamente os dois finalistas.
- Exceções (seções não instaladas, destinação ausente) ficam `needs_review`. Na base do 1º turno, todas as 41 ocorrências estão na zona do exterior, com 0 votos.
- Brasil/UF contam **zonas eleitorais inteiras** (todos os segmentos concluídos); município conta **unidades município–zona**, com esse rótulo.

## 4. Comparação 1º × 2º turno

Coorte num instante `t`: unidades concluídas no 2º turno com dados capturados até `t`, concluídas na base do 1º turno e com o mesmo conjunto de segmentos nos dois cadastros. Exclusões contadas e exibidas: `pending`, `needs_review`, `registry_changed`, `first_round_incomplete`.

Para cada turno, na coorte, somas de votos (nunca média de percentuais por zona):

- eleitorado, comparecimento, abstenção;
- válidos: Flávio, Lula, demais candidaturas (0 no 2º turno);
- não válidos (comparecimento − válidos: brancos, nulos, anulados, sub judice), com brancos e nulos separados quando úteis.

As categorias **Flávio + Lula + demais + não válidos + abstenção = eleitorado**, em cada turno. A diferença 2º − 1º por categoria soma a variação do eleitorado (≈ 0). Esse balanço é **contábil**: mostra quanto cada categoria cresceu ou encolheu no agregado, não para onde foi cada voto.

Também permitido: participação de cada finalista nos válidos e no eleitorado, por turno; quem lidera cada unidade em cada turno (`flavio`, `lula`, `outros`, `empate`) e a matriz 1º → 2º turno dessas lideranças (contagem de unidades).

## 5. Proibido

- Afirmar ou sugerir transferência de votos (“os eleitores de X foram para Y”), inclusive por correlação entre zonas apresentada como transferência.
- Previsão, projeção, probabilidade, “tendência” extrapolada, narrativa ou avaliação política.
- Somar zonas parciais para substituir o total oficial Brasil/UF; o agregado oficial EA20 é sempre a fonte do placar.
- Apresentar simulado ou fixture como oficial; misturar candidaturas simuladas com identidades oficiais.
- Preencher lacunas, interpolar no tempo ou usar informação capturada depois do instante exibido.
- Zero no lugar de ausente: denominador indefinido ou fonte indisponível aparece como `—` ou estado específico.

## 6. Base do 1º turno

Construída por `pnpm baseline:round1` a partir do banco oficial do projeto anterior (somente leitura): última versão de cada segmento, corpo bruto verificado por SHA-256 e revalidado pelo normalizador atual; corpos guardados no próprio banco. `pnpm baseline:refresh` acrescenta nova versão (sem apagar as anteriores) para segmentos não concluídos, buscando o EA20 atual a ≤ 2 req/s.

Conciliação registrada em `docs/evidence/baseline-round1.json`: após o refresh de 16/10, a soma dos 6.292 segmentos é **igual** ao agregado nacional oficial de 05/10 06:00 UTC em seções, eleitorado, comparecimento, válidos, brancos, nulos, Flávio e Lula.

## 7. Telão

Palco fixo 1920×1080 escalado à janela, tema escuro, movimento só onde informa. Placar sempre do agregado oficial EA20. Conteúdo e visual **em definição com o usuário** (ver `docs/VISUAIS.md` quando existir). Fatos aritméticos permitidos (decisão herdada do 1º turno): só quando garantidos pelos números publicados para qualquer resultado das seções restantes — no 2º turno, vitória matemática quando a vantagem supera todos os eleitores aptos das seções ainda não apuradas.

## 8. Operação

- Um único coletor TSE por máquina/IP (lock em `~/.atlas-tse/active.lock`, compartilhado entre cópias do repositório). Teto 80 req/s com rampa, decisão do usuário de 03/10/2026.
- Coleta oficial ao vivo: `pnpm collect:official:live` (dados em `data/official/round2/`).
- Processos de longa duração abertos pelo usuário em terminal próprio, máquina na tomada e sem suspensão (lições de 04/10).
