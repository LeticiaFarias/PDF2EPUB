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
let ocrWorker = null;

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
  return pdfjsLib.getDocument({ data: buffer }).promise;
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

  try {
    currentPdf = await loadPdf(file);
    await detectAndShowCover();
  } catch (err) {
    console.error(err);
    alert("Não foi possível abrir o PDF: " + err.message);
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

function groupItemsIntoLines(items) {
  const lines = [];
  let currentY = null;
  let currentLine = [];

  for (const item of items) {
    const y = Math.round(item.transform[5]);
    if (currentY === null || Math.abs(y - currentY) > 2) {
      if (currentLine.length) lines.push(currentLine.join(""));
      currentLine = [];
      currentY = y;
    }
    currentLine.push(item.str);
    if (item.hasEOL) {
      lines.push(currentLine.join(""));
      currentLine = [];
      currentY = null;
    }
  }
  if (currentLine.length) lines.push(currentLine.join(""));
  return lines;
}

async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  log("Carregando motor de OCR (primeira vez pode levar alguns segundos)…");
  ocrWorker = await Tesseract.createWorker("por", 1, {
    workerPath: chrome.runtime.getURL("js/vendor/worker.min.js"),
    corePath: chrome.runtime.getURL("js/vendor/tesseract-core-simd-lstm.js"),
    langPath: chrome.runtime.getURL("tessdata/"),
    gzip: true,
  });
  return ocrWorker;
}

async function ocrPage(page) {
  const viewport = page.getViewport({ scale: 2.2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(canvas);
  return data.text;
}

async function extractPdfText(pdf, options, aiHelpers) {
  const numPages = pdf.numPages;
  const pagesText = [];
  let ocrPagesUsed = 0;

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    let pageText = groupItemsIntoLines(textContent.items).join("\n").trim();
    let wasOcr = false;

    if (options.ocrEnabled && pageText.replace(/\s/g, "").length < 25) {
      log(`Página ${i}/${numPages}: pouco texto extraído, aplicando OCR…`);
      try {
        pageText = await ocrPage(page);
        ocrPagesUsed += 1;
        wasOcr = true;
      } catch (err) {
        log(`Página ${i}: falha no OCR (${err.message}). Seguindo sem ela.`);
      }
    } else {
      log(`Página ${i}/${numPages} processada.`);
    }

    if (wasOcr && options.aiApplyOcr && aiHelpers) {
      try {
        pageText = await aiHelpers.reviewText(pageText, "ocr", options.aiConfig, setAiStatus);
      } catch (err) {
        log(`Página ${i}: revisão por IA falhou (${err.message}).`);
      } finally {
        setAiStatus("");
      }
    }

    pagesText.push(pageText);
    setProgress(i / numPages);
  }

  if (ocrWorker) {
    await ocrWorker.terminate();
    ocrWorker = null;
  }

  return { pagesText, ocrPagesUsed, numPages };
}

// ----------------------------------------------------------------- flow

els.processBtn.addEventListener("click", async () => {
  if (!selectedFile || !currentPdf) return;
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
    const { pagesText, ocrPagesUsed, numPages } = await extractPdfText(
      currentPdf,
      {
        ocrEnabled: els.ocrToggle.checked,
        aiApplyOcr: aiMode !== "none" && els.aiApplyOcr.checked,
        aiConfig,
      },
      aiHelpers
    );

    log(
      ocrPagesUsed > 0
        ? `Concluído: ${numPages} páginas, ${ocrPagesUsed} via OCR.`
        : `Concluído: ${numPages} páginas extraídas como texto.`
    );
    log("Limpando quebras de linha e detectando parágrafos/capítulos…");

    const chapters = TextCleaner.splitIntoChapters(pagesText, {
      detectChapters: els.detectChapters.checked,
    });

    if (aiMode !== "none" && els.aiApplyAll.checked && aiHelpers) {
      for (let i = 0; i < chapters.length; i++) {
        log(`Revisando capítulo ${i + 1}/${chapters.length} com IA…`);
        const joined = chapters[i].paragraphs.join("\n\n");
        try {
          const reviewed = await aiHelpers.reviewText(joined, "chapter", aiConfig, setAiStatus);
          const paragraphs = reviewed
            .split(/\n{2,}/)
            .map((p) => TextCleaner.normalizeSpacing(p.replace(/\n/g, " ")))
            .filter(Boolean);
          if (paragraphs.length) chapters[i].paragraphs = paragraphs;
        } catch (err) {
          log(`Capítulo ${i + 1}: revisão por IA falhou (${err.message}).`);
        } finally {
          setAiStatus("");
        }
      }
    }

    log(`Pronto! ${chapters.length} capítulo(s) identificado(s). Revise abaixo antes de gerar o EPUB.`);
    renderPreview(chapters);
    els.previewSection.hidden = false;
    els.previewSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    log(`Erro: ${err.message}`);
    alert("Não foi possível processar o PDF: " + err.message);
  } finally {
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
