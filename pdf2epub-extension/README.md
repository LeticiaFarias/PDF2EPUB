# PDF → EPUB — Conversor de Novels

Extensão para Chrome/Edge que converte PDFs (traduções de novels, digitalizados
ou não) em EPUB bem formatado, com capa e revisão de texto opcional por IA.

## Como instalar

1. Baixe e descompacte esta pasta em algum lugar fixo do computador (não
   apague depois de instalar — o navegador lê os arquivos daqui).
2. Abra `chrome://extensions` (no Edge: `edge://extensions`).
3. Ative o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e selecione a pasta `pdf2epub-extension`.
5. Clique no ícone da extensão pra abrir o conversor numa aba.

## Como usar

1. Escolha o PDF. A extensão já sugere a 1ª página como capa automaticamente.
2. Ajuste título, autor, fonte, tamanho, espaçamento, capa e (se quiser) a
   revisão por IA.
3. Clique em **Processar PDF**.
4. Revise o texto na prévia — a limpeza automática já junta linhas quebradas,
   remove hifenização e separa parágrafos/diálogos. Corrija manualmente o
   que precisar (deixe uma linha em branco entre parágrafos).
5. **Gerar EPUB** → **Baixar EPUB**.

## Capa

- **Detectada automaticamente**: a 1ª página do PDF é renderizada como imagem
  e vira a capa do EPUB.
- **Enviar sua própria imagem**: escolha um arquivo de imagem (jpg/png) do
  computador para usar como capa em vez da página detectada.
- **Sem capa**: gera o EPUB sem imagem de capa.

## Revisão de texto com IA (opcional)

Três modos, escolhidos na etapa de opções:

1. **Nenhuma** — só a limpeza automática por regras (padrão, grátis, instantânea).
2. **IA gratuita integrada** — um modelo pequeno (Qwen2.5-0.5B) roda dentro do
   próprio navegador via WebAssembly/WebGPU. Não pede login nem chave. Na
   primeira vez que é usada, baixa o motor e o modelo de CDNs públicas
   (jsDelivr e Hugging Face) — isso precisa de internet uma vez; depois fica
   em cache e funciona offline. É mais lenta e tem qualidade mais simples
   que os provedores pagos abaixo — boa para corrigir espaçamento, pontuação
   e resíduos de OCR, não para revisão literária sofisticada.
3. **Minha IA (chave própria)** — você cola sua própria chave de API de
   OpenAI, Google Gemini, DeepSeek ou Anthropic Claude. A chave fica salva
   só no seu navegador (`chrome.storage.local`), nunca em nenhum servidor
   meu. **Nessa opção, o texto enviado para revisão sai do seu computador e
   vai até o servidor do provedor escolhido** — não use com conteúdo sensível.
   Cada chamada é uma cobrança na sua conta desse provedor.

Em qualquer um dos dois modos com IA, dá pra escolher separadamente:
- **Aprimorar páginas escaneadas (OCR) com IA** — roda a correção só nas
  páginas que passaram por OCR, onde o ganho é maior (letras trocadas,
  acentos perdidos). Ligado por padrão quando IA está ativa.
- **Revisar também o texto extraído normalmente** — aplica a revisão no
  livro inteiro, não só nas páginas escaneadas. Mais lento e, no caso de
  API paga, mais caro.

A IA só corrige (ortografia, pontuação, espaçamento, erros de OCR) — o
prompt usado proíbe resumir, reescrever estilo ou mudar o sentido de falas.
Ainda assim, sempre vale conferir na etapa de prévia antes de gerar o EPUB.

## Limitações conhecidas

- OCR funciona bem em texto impresso limpo; digitalizações de baixa
  qualidade podem precisar de mais correção manual.
- A detecção de capítulos é por padrão de texto (ex. "Capítulo 1"). Se a
  novel usar outro formato, desmarque a detecção automática ou ajuste os
  títulos na prévia.
- A IA gratuita local não foi testada em todos os navegadores/placas de
  vídeo — se travar ou não carregar, desative-a e use a limpeza automática
  ou uma API própria.
- As chamadas às APIs pagas dependem de cada provedor aceitar chamadas
  diretas do navegador (CORS). Se alguma delas der erro de conexão, me avise
  o texto do erro que aparece no log.
- PDFs muito grandes, com OCR ou revisão por IA em muitas páginas, podem
  demorar vários minutos.
