/**
 * epubBuilder.js
 * -----------------------------------------------------------------------
 * Monta um arquivo .epub (EPUB3, com toc.ncx extra para compatibilidade
 * com leitores/conversores mais antigos) a partir de:
 *   - metadata: { title, author, language }
 *   - chapters: [{ title, paragraphs: [string, ...] }]
 *   - style:    { fontFamily, fontSize, lineHeight, justify }
 *
 * A estrutura (parágrafo com recuo, título de capítulo centralizado,
 * primeira letra em destaque) foi inspirada no EPUB de referência que
 * a usuária enviou, mas sem embutir fontes proprietárias — assim o
 * Kindle continua livre para trocar a fonte, e o CSS embutido só define
 * um visual bonito por padrão.
 */

const EpubBuilder = (() => {
  function escapeXml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function slugForFont(fontFamily) {
    return fontFamily.split(",")[0].replace(/['"]/g, "").trim();
  }

  const FONT_STACKS = {
    serif: `"Bookerly", "Palatino Linotype", "Iowan Old Style", Georgia, "Times New Roman", serif`,
    "serif-alt": `"Literata", "PT Serif", Georgia, "Cambria", serif`,
    sans: `"Bookerly Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif`,
  };

  function buildStylesheet(style) {
    const fontStack = FONT_STACKS[style.fontFamily] || FONT_STACKS.serif;
    return `@charset "UTF-8";

html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: ${fontStack};
  font-size: ${style.fontSize}em;
  line-height: ${style.lineHeight};
  color: #1a1a1a;
}

.chapter-title {
  font-size: 1.5em;
  font-weight: 700;
  text-align: center;
  letter-spacing: 0.04em;
  margin-top: 2.2em;
  margin-bottom: 1.6em;
}

p {
  margin: 0;
  text-align: ${style.justify ? "justify" : "left"};
  text-indent: 1.4em;
  orphans: 2;
  widows: 2;
}

p.first {
  text-indent: 0;
}

p.first::first-letter {
  font-size: 1.9em;
  font-weight: 700;
  line-height: 1;
}

.titlepage {
  text-align: center;
  margin-top: 35%;
}

.titlepage h1 {
  font-size: 1.8em;
  margin-bottom: 0.3em;
}

.titlepage .author {
  font-size: 1.1em;
  font-style: italic;
  opacity: 0.8;
}
`;
  }

  function chapterXhtml(title, paragraphs, index) {
    const body = paragraphs
      .map((p, i) => `\t\t<p class="${i === 0 ? "first" : ""}">${escapeXml(p)}</p>`)
      .join("\n");
    const heading = title
      ? `\t\t<p class="chapter-title">${escapeXml(title)}</p>\n`
      : "";
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="pt-BR" xml:lang="pt-BR">
<head>
\t<meta charset="utf-8"/>
\t<title>${escapeXml(title || "Capítulo " + (index + 1))}</title>
\t<link rel="stylesheet" type="text/css" href="css/style.css"/>
</head>
<body>
\t<section epub:type="chapter">
${heading}${body}
\t</section>
</body>
</html>
`;
  }

  function titlePageXhtml(meta) {
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR" xml:lang="pt-BR">
<head>
\t<meta charset="utf-8"/>
\t<title>${escapeXml(meta.title)}</title>
\t<link rel="stylesheet" type="text/css" href="css/style.css"/>
</head>
<body>
\t<div class="titlepage">
\t\t<h1>${escapeXml(meta.title)}</h1>
\t\t<p class="author">${escapeXml(meta.author)}</p>
\t</div>
</body>
</html>
`;
  }

  function coverXhtml() {
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR" xml:lang="pt-BR">
<head>
\t<meta charset="utf-8"/>
\t<title>Capa</title>
\t<style>
\t\thtml, body { margin:0; padding:0; height:100%; text-align:center; }
\t\tdiv#cover-image { height:100%; display:flex; align-items:center; justify-content:center; }
\t\timg { max-width:100%; max-height:100%; }
\t</style>
</head>
<body>
\t<div id="cover-image"><img src="images/cover.${"__EXT__"}" alt="Capa"/></div>
</body>
</html>
`;
  }

  function containerXml() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
\t<rootfiles>
\t\t<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
\t</rootfiles>
</container>
`;
  }

  function contentOpf(meta, chapterFiles, bookUuid, cover) {
    const manifestItems = chapterFiles
      .map(
        (f, i) =>
          `\t\t<item id="chap${i + 1}" href="text/${f}" media-type="application/xhtml+xml"/>`
      )
      .join("\n");
    const spineItems = chapterFiles
      .map((f, i) => `\t\t<itemref idref="chap${i + 1}"/>`)
      .join("\n");

    const coverMediaType = cover ? (cover.mimeType || "image/jpeg") : "";
    const coverManifest = cover
      ? `\t\t<item id="cover-image" href="images/cover.${cover.extension}" media-type="${coverMediaType}" properties="cover-image"/>\n\t\t<item id="coverpage" href="text/cover.xhtml" media-type="application/xhtml+xml"/>\n`
      : "";
    const coverMeta = cover ? `\t\t<meta name="cover" content="cover-image"/>\n` : "";
    const coverSpine = cover ? `\t\t<itemref idref="coverpage"/>\n` : "";
    const coverGuide = cover
      ? `\t<guide>\n\t\t<reference type="cover" title="Capa" href="text/cover.xhtml"/>\n\t</guide>\n`
      : "";

    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId" xml:lang="pt-BR">
\t<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
\t\t<dc:identifier id="BookId">urn:uuid:${bookUuid}</dc:identifier>
\t\t<dc:title>${escapeXml(meta.title)}</dc:title>
\t\t<dc:creator>${escapeXml(meta.author)}</dc:creator>
\t\t<dc:language>${escapeXml(meta.language)}</dc:language>
\t\t<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
${coverMeta}\t</metadata>
\t<manifest>
${coverManifest}\t\t<item id="titlepage" href="text/titlepage.xhtml" media-type="application/xhtml+xml"/>
${manifestItems}
\t\t<item id="css" href="css/style.css" media-type="text/css"/>
\t\t<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
\t\t<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
\t</manifest>
\t<spine toc="ncx">
${coverSpine}\t\t<itemref idref="titlepage"/>
${spineItems}
\t</spine>
${coverGuide}</package>
`;
  }

  function navXhtml(meta, chapters) {
    const items = chapters
      .map(
        (c, i) =>
          `\t\t\t<li><a href="text/${c.file}">${escapeXml(c.title || "Capítulo " + (i + 1))}</a></li>`
      )
      .join("\n");
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="pt-BR" xml:lang="pt-BR">
<head>
\t<meta charset="utf-8"/>
\t<title>Sumário</title>
</head>
<body>
\t<nav epub:type="toc" id="toc">
\t\t<h1>Sumário</h1>
\t\t<ol>
${items}
\t\t</ol>
\t</nav>
</body>
</html>
`;
  }

  function tocNcx(meta, chapters, bookUuid) {
    const points = chapters
      .map(
        (c, i) => `\t\t<navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
\t\t\t<navLabel><text>${escapeXml(c.title || "Capítulo " + (i + 1))}</text></navLabel>
\t\t\t<content src="text/${c.file}"/>
\t\t</navPoint>`
      )
      .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
\t<head>
\t\t<meta name="dtb:uid" content="urn:uuid:${bookUuid}"/>
\t</head>
\t<docTitle><text>${escapeXml(meta.title)}</text></docTitle>
\t<navMap>
${points}
\t</navMap>
</ncx>
`;
  }

  /**
   * @param {{title:string author:string language:string}} meta
   * @param {{title:string paragraphs:string[]}[]} chapters
   * @param {{fontFamily:string fontSize:number lineHeight:number justify:boolean}} style
   * @param {{blob:Blob mimeType:string extension:string}|null} [cover]
   * @returns {Promise<Blob>}
   */
  async function build(meta, chapters, style, cover = null) {
    const zip = new JSZip();
    const bookUuid = uuid();

    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.folder("META-INF").file("container.xml", containerXml());

    const oebps = zip.folder("OEBPS");
    oebps.folder("css").file("style.css", buildStylesheet(style));
    oebps.folder("text").file("titlepage.xhtml", titlePageXhtml(meta));

    if (cover) {
      oebps.folder("images").file(`cover.${cover.extension}`, cover.blob);
      oebps.folder("text").file("cover.xhtml", coverXhtml().replace("__EXT__", cover.extension));
    }

    const chapterFiles = chapters.map((c, i) => `chap${String(i + 1).padStart(3, "0")}.xhtml`);
    chapters.forEach((c, i) => {
      oebps
        .folder("text")
        .file(chapterFiles[i], chapterXhtml(c.title, c.paragraphs, i));
    });

    const chaptersWithFiles = chapters.map((c, i) => ({ ...c, file: chapterFiles[i] }));

    oebps.file("content.opf", contentOpf(meta, chapterFiles, bookUuid, cover));
    oebps.file("nav.xhtml", navXhtml(meta, chaptersWithFiles));
    oebps.file("toc.ncx", tocNcx(meta, chaptersWithFiles, bookUuid));

    return zip.generateAsync({
      type: "blob",
      mimeType: "application/epub+zip",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  }

  return { build };
})();
