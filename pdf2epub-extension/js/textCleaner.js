/**
 * textCleaner.js
 * -----------------------------------------------------------------------
 * Limpeza e reformatação 100% automática (sem IA) do texto bruto extraído
 * de um PDF, para eliminar os problemas mais comuns desse tipo de arquivo:
 *
 *   - palavras quebradas no fim da linha por hifenização ("cora-\nção")
 *   - frases cortadas no meio por causa da quebra de linha do PDF
 *   - espaços duplicados / mal colocados antes de pontuação
 *   - numeração de página e cabeçalhos/rodapés repetidos
 *   - detecção de parágrafos (inclusive falas de diálogo com "–")
 *   - detecção automática de capítulos
 *
 * Nada aqui depende de rede ou de modelo de linguagem: é só heurística
 * de texto, então roda instantaneamente e sem custo.
 */

const TextCleaner = (() => {
  // Marcadores de início de fala/diálogo comuns em traduções PT-BR:
  // travessão ("- ela disse") ou aspas de abertura (retas ou curvas,
  // incluindo aspas francesas). Livros diferentes usam convenções
  // diferentes para marcar diálogo, então cobrimos as duas.
  const DIALOGUE_START = /^[\-\u2013\u2014"'\u201C\u2018\u00AB]\s*/;

  // Padrões de cabeçalho de capítulo (cobrem PT e EN, já que novels
  // tailandesas às vezes chegam com resquícios do inglês da tradução-ponte).
  const CHAPTER_PATTERNS = [
    /^cap[íi]tulo\s+[\divxlc]+/i,
    /^chapter\s+[\divxlc]+/i,
    /^cap\.\s*[\divxlc]+/i,
    /^parte\s+[\divxlc]+/i,
    /^epílogo$/i,
    /^pr[óo]logo$/i,
    /^extra\s*[\divxlc]*$/i,
  ];

  // Linha "solta" que é só um número de página, geralmente lixo de rodapé.
  const PAGE_NUMBER_LINE = /^\s*[\divxlc]{1,4}\s*$/i;

  const SENTENCE_END = /[.!?…”"»›)\]]\s*$/;

  function isChapterHeading(line) {
    const t = line.trim();
    if (!t || t.length > 60) return false;
    return CHAPTER_PATTERNS.some((re) => re.test(t));
  }

  function isLikelyPageArtifact(line) {
    const t = line.trim();
    if (!t) return true;
    if (PAGE_NUMBER_LINE.test(t)) return true;
    return false;
  }

  function normalizeSpacing(text) {
    return text
      .replace(/\u00AD/g, "") // hífen suave invisível
      .replace(/[ \t]+/g, " ")
      .replace(/ +([,.;:!?…])/g, "$1")
      .replace(/«\s+/g, "«")
      .replace(/\s+»/g, "»")
      .replace(/ﬁ/g, "fi")
      .replace(/ﬂ/g, "fl")
      .trim();
  }

  /**
   * Junta as linhas quebradas de um PDF em parágrafos de verdade.
   * Recebe o texto cru de UMA página (ou do documento inteiro) e devolve
   * uma lista de parágrafos já unidos, sem cortes no meio da frase.
   */
  function joinLinesIntoParagraphs(rawText) {
    // Linhas de artefato (números de página soltos) viram linha em
    // branco em vez de serem removidas de vez — assim elas continuam
    // funcionando como separador de parágrafo/página, em vez de fazer
    // dois parágrafos de páginas diferentes grudarem um no outro.
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.replace(/[ \t]+$/, ""))
      .map((l) => (isLikelyPageArtifact(l) ? "" : l));

    const paragraphs = [];
    let current = "";

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();

      if (!line) {
        if (current) {
          paragraphs.push(current);
          current = "";
        }
        continue;
      }

      if (isChapterHeading(line)) {
        if (current) {
          paragraphs.push(current);
          current = "";
        }
        paragraphs.push("§CHAPTER§" + line);
        continue;
      }

      const startsNewDialogue = DIALOGUE_START.test(line) && current !== "";

      if (!current) {
        current = line;
        continue;
      }

      if (startsNewDialogue) {
        // Nova fala de diálogo: fecha o parágrafo anterior.
        paragraphs.push(current);
        current = line;
        continue;
      }

      // Hifenização de fim de linha: "cora-" + "ção" -> "coração"
      if (/[a-zà-ú]-$/i.test(current) && /^[a-zà-ú]/i.test(line)) {
        current = current.replace(/-$/, "") + line;
        continue;
      }

      // Se a linha anterior já termina a frase E a linha atual parece
      // iniciar um novo parágrafo (letra maiúscula), preferimos manter
      // como parágrafo novo só quando havia uma linha em branco — como
      // aqui não há, tratamos como continuação do mesmo parágrafo
      // (comportamento mais comum em PDFs justificados).
      current += (SENTENCE_END.test(current) ? " " : " ") + line;
    }

    if (current) paragraphs.push(current);

    return paragraphs.map(normalizeSpacing).filter(Boolean);
  }

  /**
   * Recebe o texto de todas as páginas (array de strings) já unido,
   * devolve a lista de capítulos: [{ title, paragraphs: [...] }]
   */
  function splitIntoChapters(allPagesText, { detectChapters = true } = {}) {
    const fullRaw = allPagesText.join("\n\n");
    const paragraphs = joinLinesIntoParagraphs(fullRaw);

    const chapters = [];
    let current = { title: "", paragraphs: [] };
    let chapterCount = 0;

    for (const p of paragraphs) {
      if (detectChapters && p.startsWith("§CHAPTER§")) {
        if (current.paragraphs.length > 0 || current.title) {
          chapters.push(current);
        }
        chapterCount += 1;
        current = { title: p.replace("§CHAPTER§", ""), paragraphs: [] };
        continue;
      }
      current.paragraphs.push(p.replace("§CHAPTER§", ""));
    }
    if (current.paragraphs.length > 0 || current.title) chapters.push(current);

    // Se nada foi detectado como capítulo, tudo cai num único capítulo.
    if (chapterCount === 0) {
      return [{ title: "", paragraphs }];
    }

    // Um primeiro "capítulo" sem título e sem texto (só ruído antes do
    // capítulo 1) é descartado; se tiver texto, vira "Abertura".
    if (chapters[0] && !chapters[0].title) {
      if (chapters[0].paragraphs.length === 0) {
        chapters.shift();
      } else {
        chapters[0].title = "Abertura";
      }
    }

    return chapters;
  }

  return { joinLinesIntoParagraphs, splitIntoChapters, normalizeSpacing };
})();
