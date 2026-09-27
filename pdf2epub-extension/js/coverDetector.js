/* global pdfjsLib */

/**
 * coverDetector.js
 * -----------------------------------------------------------------------
 * Gera a imagem de capa a partir da 1ª página do PDF (renderizada em
 * canvas), ou empacota uma imagem enviada manualmente pela usuária —
 * nos dois casos devolvendo {blob, mimeType, dataUrl} pronto para
 * pré-visualização e para ser embutido no EPUB.
 */

const CoverDetector = (() => {
  async function fromFirstPage(pdf, targetWidth = 1200) {
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    return { blob, mimeType: "image/jpeg", dataUrl, extension: "jpg" };
  }

  async function fromUploadedFile(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const extension = (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
    return { blob: file, mimeType: file.type || "image/jpeg", dataUrl, extension };
  }

  return { fromFirstPage, fromUploadedFile };
})();
