/* global AiLocal, AiProviders */

/**
 * aiReviewer.js
 * -----------------------------------------------------------------------
 * Ponto único que decide COMO revisar um pedaço de texto (modelo local
 * ou API externa) e QUANTO texto mandar de cada vez, sem nunca deixar a
 * IA resumir, reescrever ou "melhorar" o estilo — só corrigir.
 */

const AiReviewer = (() => {
  const GENERAL_PROMPT = `Você é um revisor de texto. Corrija apenas erros de ortografia, acentuação, pontuação e espaçamento no trecho abaixo, de uma tradução de novel para português do Brasil.
Regras obrigatórias:
- NÃO resuma, NÃO reescreva o estilo, NÃO mude o sentido de falas ou diálogos.
- NÃO adicione nem remova frases ou parágrafos.
- Mantenha exatamente a mesma quantidade de parágrafos, separados por linha em branco.
- Devolva só o texto corrigido, sem comentários, sem introdução, sem aspas envolvendo o texto todo.`;

  const OCR_PROMPT = `Você é um revisor especializado em corrigir erros de OCR (reconhecimento óptico de caracteres) em português do Brasil. O texto abaixo veio de uma página escaneada e pode ter letras trocadas, acentos errados ou ausentes, palavras coladas ou cortadas, e espaçamento incorreto.
Regras obrigatórias:
- Corrija só esses erros de reconhecimento, sem mudar o conteúdo ou o sentido.
- NÃO resuma, NÃO reescreva o estilo.
- Mantenha a mesma quantidade de parágrafos, separados por linha em branco.
- Devolva só o texto corrigido, sem comentários.`;

  function maxCharsFor(settings) {
    return settings.provider === "local" ? 900 : 3500;
  }

  // Um parágrafo maior que o limite de um bloco é quebrado em pedaços
  // menores, preferindo o fim de frase mais próximo do limite.
  function splitLongParagraph(paragraph, maxChars) {
    const pieces = [];
    let rest = paragraph;

    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars);
      let cut = -1;
      for (const match of window.matchAll(/[.!?…]["'”’»)\]]*\s+/g)) {
        cut = match.index + match[0].length;
      }
      if (cut <= maxChars * 0.4) {
        const lastSpace = window.lastIndexOf(" ");
        cut = lastSpace > maxChars * 0.4 ? lastSpace + 1 : maxChars;
      }
      pieces.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut);
    }
    if (rest.trim()) pieces.push(rest.trim());
    return pieces;
  }

  // Quebra o texto em blocos respeitando limites de parágrafo (nunca
  // corta um parágrafo ao meio entre um bloco e outro, exceto quando o
  // próprio parágrafo é maior que o limite).
  function chunkByParagraph(text, maxChars) {
    const paragraphs = text
      .split(/\n{2,}/)
      .flatMap((p) => (p.length + 2 > maxChars ? splitLongParagraph(p, maxChars) : [p]));
    const chunks = [];
    let current = [];
    let currentLen = 0;

    for (const p of paragraphs) {
      const len = p.length + 2;
      if (currentLen + len > maxChars && current.length > 0) {
        chunks.push(current.join("\n\n"));
        current = [];
        currentLen = 0;
      }
      current.push(p);
      currentLen += len;
    }
    if (current.length) chunks.push(current.join("\n\n"));
    return chunks;
  }

  async function reviewChunk(settings, systemPrompt, text, onProgress) {
    if (settings.provider === "local") {
      return AiLocal.generate(systemPrompt, text, onProgress);
    }
    return AiProviders.callExternalAI(
      settings.provider,
      settings.apiKey,
      settings.model,
      systemPrompt,
      text,
      onProgress
    );
  }

  /**
   * Revisa um texto "solto" (ex.: uma página de OCR) e devolve o
   * resultado corrigido. Em caso de falha, devolve o texto original.
   */
  async function reviewRawText(settings, text, { isOcr = false, onProgress } = {}) {
    if (!settings || !settings.provider || !text.trim()) return text;
    const prompt = isOcr ? OCR_PROMPT : GENERAL_PROMPT;
    const maxChars = maxCharsFor(settings);
    const chunks = chunkByParagraph(text, maxChars);
    const out = [];

    for (let i = 0; i < chunks.length; i++) {
      try {
        const reviewed = await reviewChunk(settings, prompt, chunks[i], onProgress);
        out.push(reviewed);
      } catch (err) {
        onProgress?.(`Aviso: revisão por IA falhou num trecho (${err.message}). Mantendo o texto original ali.`);
        out.push(chunks[i]);
      }
    }
    return out.join("\n\n");
  }

  /**
   * Wrapper de conveniência usado pela UI: revisa um texto "solto"
   * (página OCR ou capítulo inteiro já unido) sem precisar montar o
   * objeto de opções {isOcr} na mão.
   * kind: "ocr" | "chapter" | "general"
   */
  async function reviewText(text, kind, settings, onProgress) {
    return reviewRawText(settings, text, { isOcr: kind === "ocr", onProgress });
  }

  return { reviewRawText, reviewText };
})();
