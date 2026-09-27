/* global pdfjsLib, JSZip, Tesseract, TextCleaner, EpubBuilder, CoverDetector, AiReviewer, chrome */

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("js/vendor/pdf.worker.min.js");

const els = {
  fileInput: document.getElementById("fileInput"),
  dropZone: document.getElementById("dropZone"),
  fileName: document.getElementById("fileName"),
  optionsSection: document.getElementById("optionsSection"),
  title: document.getElementById("bookTitle"),
  author: document.getElementById("bookAuthor"),
  ocrToggle: document.getElementById("ocrToggle"),
  detectChapters: document.getElementById("detectChapters"),
  justify: document.getElementById("justify"),
  fontFamily: document.getElementById("fontFamily"),
  fontSize: document.getElementById("fontSize"),
  lineHeight: document.getElementById("lineHeight"),

  coverPreviewImg: document.getElementById("coverPreviewImg"),
  coverPreviewEmpty: document.getElementById("coverPreviewEmpty"),
  coverFileInput: document.getElementById("coverFileInput"),

  aiCustomFields: document.getElementById("aiCustomFields"),
  aiScopeFields: document.getElementById("aiScopeFields"),
  aiProvider: document.getElementById("aiProvider"),
  aiModel: document.getElementById("aiModel"),
  aiApiKey: document.getElementById("aiApiKey"),
  aiRememberKey: document.getElementById("aiRememberKey"),
  aiApplyOcr: document.getElementById("aiApplyOcr"),
  aiApplyAll: document.getElementById("aiApplyAll"),
  aiStatusLine: document.getElementById("aiStatusLine"),

  processBtn: document.getElementById("processBtn"),
  progressSection: document.getElementById("progressSection"),
  progressBar: document.getElementById("progressBar"),
  progressLog: document.getElementById("progressLog"),
  previewSection: document.getElementById("previewSection"),
  chaptersContainer: document.getElementById("chaptersContainer"),
  buildBtn: document.getElementById("buildBtn"),
  downloadSection: document.getElementById("downloadSection"),
  downloadLink: document.getElementById("downloadLink"),
  finalFileName: document.getElementById("finalFileName"),
};

let selectedFile = null;
let currentPdf = null; // documento pdf.js já carregado, reaproveitado entre capa e extração
let detectedCover = null; // {blob, mimeType, dataUrl, extension}
let uploadedCover = null;
let ocrWorkers = [];

// Falha ao carregar o próprio motor de OCR (arquivos ausentes em
// js/vendor ou tessdata): diferente de uma página que não pôde ser lida,
// isso inviabiliza o processamento inteiro.
class OcrEngineError extends Error {}

// ---------------------------------------------------------------- helpers

function log(msg) {
  const line = document.createElement("div");
  line.textContent = msg;
  els.progressLog.appendChild(line);
  els.progressLog.scrollTop = els.progressLog.scrollHeight;
}

function setAiStatus(msg) {
  els.aiStatusLine.textContent = msg || "";
}

function setProgress(fraction) {
  els.progressBar.style.width = `${Math.round(fraction * 100)}%`;
}

function formatDuration(seconds) {
  const total = Math.max(1, Math.round(seconds));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}min ${String(total % 60).padStart(2, "0")}s`;
}

function guessTitleFromFileName(name) {
  return name
    .replace(/\.pdf$/i, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------- config de IA

async function loadSavedAiSettings() {
  try {
    const saved = await chrome.storage.local.get(["aiProvider", "aiModel", "aiApiKey", "aiRememberKey"]);
    if (saved.aiProvider) els.aiProvider.value = saved.aiProvider;
    if (saved.aiModel) els.aiModel.value = saved.aiModel;
    if (saved.aiRememberKey && saved.aiApiKey) {
      els.aiApiKey.value = saved.aiApiKey;
      els.aiRememberKey.checked = true;
    }
  } catch (err) {
    console.warn("Não foi possível carregar configurações salvas:", err);
  }
}

async function persistAiSettingsIfNeeded() {
  try {
    if (els.aiRememberKey.checked) {
      await chrome.storage.local.set({
        aiProvider: els.aiProvider.value,
        aiModel: els.aiModel.value.trim(),
        aiApiKey: els.aiApiKey.value.trim(),
        aiRememberKey: true,
      });
    } else {
      await chrome.storage.local.set({ aiRememberKey: false, aiApiKey: "" });
    }
  } catch (err) {
    console.warn("Não foi possível salvar configurações:", err);
  }
}

function getAiMode() {
  const el = document.querySelector('input[name="aiMode"]:checked');
  return el ? el.value : "none";
}

function getAiConfig() {
  const mode = getAiMode();
  if (mode === "custom") {
    return {
      mode: "custom",
      provider: els.aiProvider.value,
      apiKey: els.aiApiKey.value.trim(),
      model: els.aiModel.value.trim(),
    };
  }
  if (mode === "local") {
    return { mode: "local", provider: "local" };
  }
  return { mode: "none" };
}

document.querySelectorAll('input[name="aiMode"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const mode = getAiMode();
    els.aiCustomFields.hidden = mode !== "custom";
    els.aiScopeFields.hidden = mode === "none";
  });
});

loadSavedAiSettings();

// ------------------------------------------------------------ file input

async function loadPdf(file) {
  const buffer = await file.arrayBuffer();
  const task = pdfjsLib.getDocument({ data: buffer });
  // PDFs criptografados: pedimos a senha à usuária em vez de deixar o
  // pdf.js falhar com um erro genérico.
  task.onPassword = (updatePassword, reason) => {
    const again = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
    const password = prompt(
      again
        ? "Senha incorreta. Digite a senha do PDF:"
        : "Este PDF está protegido por senha. Digite a senha para abrir:"
    );
    if (password === null) {
      task.destroy();
      return;
    }
    updatePassword(password);
  };
  return task.promise;
}

async function detectAndShowCover() {
  try {
    detectedCover = await CoverDetector.fromFirstPage(currentPdf);
    if (document.querySelector('input[name="coverSource"]:checked').value === "detected") {
      showCoverPreview(detectedCover.dataUrl);
    }
  } catch (err) {
    console.warn("Não foi possível detectar a capa automaticamente:", err);
  }
}

function showCoverPreview(dataUrl) {
  if (dataUrl) {
    els.coverPreviewImg.src = dataUrl;
    els.coverPreviewImg.hidden = false;
    els.coverPreviewEmpty.hidden = true;
  } else {
    els.coverPreviewImg.hidden = true;
    els.coverPreviewEmpty.hidden = false;
  }
}

document.querySelectorAll('input[name="coverSource"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const value = radio.value;
    els.coverFileInput.hidden = value !== "upload";
    if (value === "detected") {
      showCoverPreview(detectedCover ? detectedCover.dataUrl : null);
    } else if (value === "upload") {
      if (uploadedCover) {
        showCoverPreview(uploadedCover.dataUrl);
      } else {
        showCoverPreview(null);
        els.coverFileInput.click();
      }
    } else {
      showCoverPreview(null);
    }
  });
});

els.coverFileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  uploadedCover = await CoverDetector.fromUploadedFile(file);
  showCoverPreview(uploadedCover.dataUrl);
});

function getChosenCover() {
  const value = document.querySelector('input[name="coverSource"]:checked').value;
  if (value === "detected") return detectedCover;
  if (value === "upload") return uploadedCover;
  return null;
}

async function handleFile(file) {
  if (file && !/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    alert("Escolha um arquivo PDF.");
    return;
  }
  selectedFile = file;
  detectedCover = null;
  uploadedCover = null;
  els.fileName.textContent = file.name;
  els.title.value = guessTitleFromFileName(file.name);
  els.optionsSection.hidden = false;
  els.previewSection.hidden = true;
  els.downloadSection.hidden = true;
  showCoverPreview(null);
  els.optionsSection.scrollIntoView({ behavior: "smooth", block: "start" });

  currentPdf = null;
  try {
    currentPdf = await loadPdf(file);
    await detectAndShowCover();
  } catch (err) {
    console.error(err);
    const isPasswordIssue = err?.name === "PasswordException";
    alert(
      isPasswordIssue
        ? "Este PDF está protegido por senha e não pôde ser aberto. Remova a proteção (ou informe a senha correta) e tente de novo."
        : "Não foi possível abrir o PDF: " + err.message
    );
  }
}

els.fileInput.addEventListener("change", (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

["dragenter", "dragover"].forEach((evt) =>
  els.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropZone.classList.add("drag-active");
  })
);
["dragleave", "drop"].forEach((evt) =>
  els.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropZone.classList.remove("drag-active");
  })
);
els.dropZone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

// -------------------------------------------------------- PDF text/OCR

// Junta os itens de texto de uma linha inserindo espaço quando o PDF não
// o traz explicitamente: itens vizinhos costumam ser fragmentos da mesma
// palavra (sem espaço), mas um salto horizontal relevante entre eles
// significa tabulação, coluna ou espaço de verdade.
function joinLineItems(parts) {
  let line = "";
  let prev = null;

  for (const { str, item } of parts) {
    if (!str) {
      prev = item;
      continue;
    }
    if (line) {
      const endsWithSpace = /\s$/.test(line);
      const startsWithSpace = /^\s/.test(str);
      const prevEnd = prev ? prev.transform[4] + (prev.width || 0) : null;
      const gap = prevEnd !== null ? item.transform[4] - prevEnd : 0;
      const spaceWidth = (item.height || 10) * 0.25;
      if (!endsWithSpace && !startsWithSpace && gap > spaceWidth) line += " ";
    }
    line += str;
    prev = item;
  }
  return line;
}

function groupItemsIntoLines(items) {
  const lines = [];
  let currentY = null;
  let currentLine = [];

  for (const item of items) {
    const y = Math.round(item.transform[5]);
    if (currentY === null || Math.abs(y - currentY) > 2) {
      if (currentLine.length) lines.push(joinLineItems(currentLine));
      currentLine = [];
      currentY = y;
    }
    currentLine.push({ str: item.str, item });
    if (item.hasEOL) {
      lines.push(joinLineItems(currentLine));
      currentLine = [];
      currentY = null;
    }
  }
  if (currentLine.length) lines.push(joinLineItems(currentLine));
  return lines;
}

// Escala de renderização para OCR: mira ~2000px de largura, que é o
// suficiente para o Tesseract ler texto de livro, sem gastar memória e
// tempo renderizando páginas gigantes.
const OCR_TARGET_WIDTH = 2000;
const OCR_MIN_SCALE = 1.2;
const OCR_MAX_SCALE = 2.2;
const OCR_MAX_WORKERS = 4;

function ocrScaleFor(page) {
  const base = page.getViewport({ scale: 1 });
  const scale = OCR_TARGET_WIDTH / base.width;
  return Math.min(OCR_MAX_SCALE, Math.max(OCR_MIN_SCALE, scale));
}

async function createOcrWorker() {
  if (typeof Tesseract === "undefined" || !Tesseract.createWorker) {
    throw new OcrEngineError("a biblioteca tesseract.js não foi carregada");
  }
  try {
    return await Tesseract.createWorker("por", 1, {
      workerPath: chrome.runtime.getURL("js/vendor/worker.min.js"),
      corePath: chrome.runtime.getURL("js/vendor/tesseract-core-simd-lstm.js"),
      langPath: chrome.runtime.getURL("tessdata/"),
      gzip: true,
    });
  } catch (err) {
    throw new OcrEngineError(err.message);
  }
}

async function getOcrPool(size) {
  if (ocrWorkers.length >= size) return ocrWorkers.slice(0, size);
  log(`Carregando motor de OCR (${size} processo(s) em paralelo; a primeira vez leva alguns segundos)…`);
  const created = await Promise.all(
    Array.from({ length: size - ocrWorkers.length }, () => createOcrWorker())
  );
  ocrWorkers = ocrWorkers.concat(created);
  return ocrWorkers;
}

async function terminateOcrPool() {
  const workers = ocrWorkers;
  ocrWorkers = [];
  await Promise.all(
    workers.map((worker) => worker.terminate().catch((err) => console.warn("OCR terminate:", err)))
  );
}

async function renderPageToCanvas(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

function poolSizeFor(pageCount) {
  const cores = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(OCR_MAX_WORKERS, pageCount, Math.floor(cores / 2) || 1));
}

/**
 * Roda OCR nas páginas indicadas usando vários workers em paralelo.
 * Uma falha em uma página específica é registrada e a página fica sem
 * texto; uma falha ao criar o motor (OcrEngineError) interrompe tudo.
 */
async function ocrPages(pdf, pageNumbers) {
  const workers = await getOcrPool(poolSizeFor(pageNumbers.length));
  const texts = new Map();
  const failed = [];
  const startedAt = performance.now();
  let done = 0;
  let next = 0;

  await Promise.all(
    workers.map(async (worker) => {
      while (next < pageNumbers.length) {
        const pageNumber = pageNumbers[next++];
        try {
          const page = await pdf.getPage(pageNumber);
          const canvas = await renderPageToCanvas(page, ocrScaleFor(page));
          const { data } = await worker.recognize(canvas);
          texts.set(pageNumber, data.text);
          canvas.width = 0;
          canvas.height = 0;
        } catch (err) {
          failed.push(pageNumber);
          log(`Página ${pageNumber}: falha no OCR (${err.message}).`);
        }
        done += 1;
        const elapsed = (performance.now() - startedAt) / 1000;
        const remaining = (elapsed / done) * (pageNumbers.length - done);
        log(
          `OCR ${done}/${pageNumbers.length} página(s)` +
            (done < pageNumbers.length ? ` — restam ~${formatDuration(remaining)}.` : ".")
        );
      }
    })
  );

  return { texts, failed };
}

async function extractPdfText(pdf, options, aiHelpers) {
  const numPages = pdf.numPages;
  const pagesText = [];
  const needsOcr = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = groupItemsIntoLines(textContent.items).join("\n").trim();
    pagesText.push(pageText);
    if (options.ocrEnabled && pageText.replace(/\s/g, "").length < 25) needsOcr.push(i);
    setProgress((i / numPages) * (options.ocrEnabled ? 0.3 : 1));
  }

  log(
    needsOcr.length
      ? `${numPages} página(s) lidas; ${needsOcr.length} sem texto selecionável vão passar por OCR.`
      : `${numPages} página(s) lidas como texto.`
  );

  const ocrPageNumbers = [];
  if (needsOcr.length) {
    const { texts, failed } = await ocrPages(pdf, needsOcr);
    for (const [pageNumber, text] of texts) {
      pagesText[pageNumber - 1] = text;
      ocrPageNumbers.push(pageNumber);
    }
    if (failed.length) log(`${failed.length} página(s) ficaram sem texto após o OCR.`);
    setProgress(0.85);
  }

  // Cada página passa pela IA no máximo uma vez: as de OCR com o prompt
  // de OCR, as demais (só quando "revisar tudo" está marcado) com o
  // prompt geral.
  const isOcrPage = new Set(ocrPageNumbers);
  const toReview = [];
  for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
    if (!pagesText[pageNumber - 1].trim()) continue;
    if (isOcrPage.has(pageNumber)) {
      if (options.aiApplyOcr) toReview.push({ pageNumber, kind: "ocr" });
    } else if (options.aiApplyAll) {
      toReview.push({ pageNumber, kind: "general" });
    }
  }

  if (aiHelpers && toReview.length) {
    for (let i = 0; i < toReview.length; i++) {
      const { pageNumber, kind } = toReview[i];
      log(`Revisando com IA a página ${pageNumber} (${i + 1}/${toReview.length})…`);
      try {
        pagesText[pageNumber - 1] = await aiHelpers.reviewText(
          pagesText[pageNumber - 1],
          kind,
          options.aiConfig,
          setAiStatus
        );
      } catch (err) {
        log(`Página ${pageNumber}: revisão por IA falhou (${err.message}).`);
      } finally {
        setAiStatus("");
      }
      setProgress(0.85 + (0.15 * (i + 1)) / toReview.length);
    }
  }

  const emptyPages = pagesText.filter((text) => !text.trim()).length;
  setProgress(1);

  return { pagesText, ocrPagesUsed: ocrPageNumbers.length, numPages, emptyPages, ocrPageNumbers };
}

// ----------------------------------------------------------------- flow

els.processBtn.addEventListener("click", async () => {
  if (!selectedFile) {
    alert("Escolha um arquivo PDF antes de processar.");
    return;
  }
  if (!currentPdf) {
    alert(
      "Este PDF não pôde ser aberto (pode estar protegido por senha, corrompido ou incompleto). " +
        "Escolha o arquivo de novo ou remova a proteção antes de converter."
    );
    return;
  }
  els.processBtn.disabled = true;
  els.progressSection.hidden = false;
  els.previewSection.hidden = true;
  els.downloadSection.hidden = true;
  els.progressLog.innerHTML = "";
  setAiStatus("");
  setProgress(0);

  const aiMode = getAiMode();
  const aiConfig = getAiConfig();
  await persistAiSettingsIfNeeded();

  const aiHelpers = aiMode !== "none" ? AiReviewer : null;

  try {
    const { pagesText, ocrPagesUsed, numPages, emptyPages } = await extractPdfText(
      currentPdf,
      {
        ocrEnabled: els.ocrToggle.checked,
        aiApplyOcr: aiMode !== "none" && els.aiApplyOcr.checked,
        aiApplyAll: aiMode !== "none" && els.aiApplyAll.checked,
        aiConfig,
      },
      aiHelpers
    );

    log(
      ocrPagesUsed > 0
        ? `Concluído: ${numPages} páginas, ${ocrPagesUsed} via OCR.`
        : `Concluído: ${numPages} páginas extraídas como texto.`
    );
    if (emptyPages > 0) log(`Atenção: ${emptyPages} de ${numPages} página(s) ficaram sem nenhum texto.`);

    if (pagesText.every((text) => !text.trim())) {
      const motivo = els.ocrToggle.checked
        ? "Nem a extração de texto nem o OCR encontraram conteúdo neste PDF."
        : "Este PDF não tem texto selecionável e o OCR está desligado.";
      log(`${motivo} Nenhum EPUB foi gerado.`);
      alert(
        `${motivo}\n\n` +
          (els.ocrToggle.checked
            ? "Verifique se o PDF tem mesmo conteúdo legível (pode ser um scan de péssima qualidade ou páginas em branco)."
            : 'Marque a opção "Usar OCR em páginas escaneadas" e tente de novo.')
      );
      return;
    }

    log("Limpando quebras de linha e detectando parágrafos/capítulos…");

    const chapters = TextCleaner.splitIntoChapters(pagesText, {
      detectChapters: els.detectChapters.checked,
    });

    if (chapters.every((c) => c.paragraphs.length === 0)) {
      log("Depois da limpeza não sobrou nenhum parágrafo. Nenhum EPUB foi gerado.");
      alert("Depois da limpeza automática não sobrou texto nenhum — nenhum EPUB foi gerado.");
      return;
    }

    log(`Pronto! ${chapters.length} capítulo(s) identificado(s). Revise abaixo antes de gerar o EPUB.`);
    renderPreview(chapters);
    els.previewSection.hidden = false;
    els.previewSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    if (err instanceof OcrEngineError) {
      const msg =
        "O motor de OCR não pôde ser carregado — verifique os arquivos em js/vendor " +
        `(tesseract.min.js, worker.min.js, tesseract-core-simd-lstm.js/.wasm) e em tessdata/ (por.traineddata.gz). Detalhe: ${err.message}`;
      log(msg);
      alert(msg);
    } else {
      log(`Erro: ${err.message}`);
      alert("Não foi possível processar o PDF: " + err.message);
    }
  } finally {
    await terminateOcrPool();
    els.processBtn.disabled = false;
    setAiStatus("");
  }
});

// ------------------------------------------------------------- preview

function renderPreview(chapters) {
  els.chaptersContainer.innerHTML = "";
  chapters.forEach((chapter, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "chapter-editor";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "chapter-title-input";
    titleInput.value = chapter.title || `Capítulo ${idx + 1}`;
    titleInput.placeholder = "Título do capítulo (deixe vazio para não exibir)";

    const textArea = document.createElement("textarea");
    textArea.className = "chapter-textarea";
    textArea.rows = 10;
    textArea.value = chapter.paragraphs.join("\n\n");
    textArea.spellcheck = true;
    textArea.lang = "pt-BR";

    const label = document.createElement("div");
    label.className = "chapter-label";
    label.textContent = `Capítulo ${idx + 1}`;

    wrap.appendChild(label);
    wrap.appendChild(titleInput);
    wrap.appendChild(textArea);
    els.chaptersContainer.appendChild(wrap);
  });
}

function readChaptersFromPreview() {
  const editors = els.chaptersContainer.querySelectorAll(".chapter-editor");
  return Array.from(editors).map((wrap) => {
    const title = wrap.querySelector(".chapter-title-input").value.trim();
    const rawText = wrap.querySelector(".chapter-textarea").value;
    const paragraphs = rawText
      .split(/\n{2,}/)
      .map((p) => TextCleaner.normalizeSpacing(p.replace(/\n/g, " ")))
      .filter(Boolean);
    return { title, paragraphs };
  });
}

// --------------------------------------------------------------- build

els.buildBtn.addEventListener("click", async () => {
  const chapters = readChaptersFromPreview();
  if (chapters.every((c) => c.paragraphs.length === 0)) {
    alert("Não há texto para gerar o EPUB.");
    return;
  }

  els.buildBtn.disabled = true;
  try {
    const style = {
      fontFamily: els.fontFamily.value,
      fontSize: parseFloat(els.fontSize.value),
      lineHeight: parseFloat(els.lineHeight.value),
      justify: els.justify.checked,
    };
    const meta = {
      title: els.title.value.trim() || "Sem título",
      author: els.author.value.trim() || "Autor desconhecido",
      language: "pt-BR",
    };
    const cover = getChosenCover();
    const coverForBuilder = cover ? { blob: cover.blob, mimeType: cover.mimeType, extension: cover.extension } : null;

    const blob = await EpubBuilder.build(meta, chapters, style, coverForBuilder);
    const url = URL.createObjectURL(blob);
    const fileName = `${meta.title.replace(/[\\/:*?"<>|]+/g, "")}.epub`;

    els.downloadLink.href = url;
    els.downloadLink.download = fileName;
    els.finalFileName.textContent = fileName;
    els.downloadSection.hidden = false;
    els.downloadSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    alert("Não foi possível gerar o EPUB: " + err.message);
  } finally {
    els.buildBtn.disabled = false;
  }
});
