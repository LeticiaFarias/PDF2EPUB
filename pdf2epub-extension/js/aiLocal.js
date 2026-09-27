/**
 * aiLocal.js
 * -----------------------------------------------------------------------
 * IA "gratuita integrada": um modelo pequeno (Qwen2.5-0.5B-Instruct)
 * rodando inteiramente no navegador via transformers.js/ONNX Runtime Web,
 * sem login, sem chave de API e sem custo.
 *
 * O motor (onnxruntime-web) vem empacotado na extensão, em
 * js/vendor/ort/: o Manifest V3 proíbe carregar código JavaScript remoto,
 * então os caminhos do wasm são apontados explicitamente para arquivos
 * locais em vez da CDN padrão do transformers.js.
 *
 * Duas ressalvas importantes, mostradas também na interface:
 *  1) Na primeira vez que essa opção é usada, o navegador baixa os pesos
 *     do modelo do Hugging Face (só dados, via fetch) — isso exige
 *     internet nessa primeira vez. Depois fica em cache e funciona sem rede.
 *  2) É um modelo pequeno: bom para corrigir espaçamento, pontuação e
 *     resíduos de OCR, mas não tem a qualidade de um GPT/Gemini/Claude
 *     "grande". Para revisão mais sofisticada, use a opção de API própria.
 */

const AiLocal = (() => {
  const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
  const LIB_URL = chrome.runtime.getURL("js/vendor/transformers.web.min.js");
  const ORT_WASM_PATHS = {
    mjs: chrome.runtime.getURL("js/vendor/ort/ort-wasm-simd-threaded.asyncify.mjs"),
    wasm: chrome.runtime.getURL("js/vendor/ort/ort-wasm-simd-threaded.asyncify.wasm"),
  };
  const MAX_NEW_TOKENS_CAP = 4096;

  let generatorPromise = null;

  function pickDevice() {
    return typeof navigator !== "undefined" && navigator.gpu ? "webgpu" : "wasm";
  }

  async function getGenerator(onProgress) {
    if (generatorPromise) return generatorPromise;

    generatorPromise = (async () => {
      const { pipeline, env } = await import(LIB_URL);

      // MV3 bloqueia import de script remoto: o runtime wasm precisa vir
      // dos arquivos vendorizados na extensão, não da jsDelivr.
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      const wasmEnv = env.backends.onnx.wasm;
      wasmEnv.wasmPaths = ORT_WASM_PATHS;
      wasmEnv.proxy = false;
      if (!self.crossOriginIsolated) wasmEnv.numThreads = 1;

      const device = pickDevice();
      const dtype = device === "webgpu" ? "q4f16" : "q4";

      onProgress?.(
        `Carregando modelo de IA local (${device === "webgpu" ? "acelerado por GPU" : "modo CPU/WASM"})…`
      );

      return pipeline("text-generation", MODEL_ID, {
        device,
        dtype,
        progress_callback: (info) => {
          if (info.status === "progress" && info.file) {
            const pct = info.total ? Math.round((info.loaded / info.total) * 100) : null;
            onProgress?.(
              `Baixando ${info.file}${pct !== null ? ` (${pct}%)` : ""}… isso só acontece na primeira vez.`
            );
          }
        },
      });
    })();

    return generatorPromise;
  }

  function extractReply(output) {
    const item = Array.isArray(output) ? output[0] : output;
    const gen = item?.generated_text;
    if (Array.isArray(gen)) {
      const last = gen[gen.length - 1];
      return (last?.content || "").trim();
    }
    if (typeof gen === "string") {
      // Alguns backends devolvem o prompt inteiro + a resposta; ficamos
      // só com o que vem depois do último turno do usuário.
      const marker = "assistant";
      const idx = gen.lastIndexOf(marker);
      return (idx >= 0 ? gen.slice(idx + marker.length) : gen).trim();
    }
    return "";
  }

  /**
   * @param {string} systemPrompt
   * @param {string} userText
   * @param {(msg:string)=>void} onProgress
   * @returns {Promise<string>}
   */
  async function generate(systemPrompt, userText, onProgress) {
    const generator = await getGenerator(onProgress);
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ];
    const output = await generator(messages, {
      // A revisão preserva o volume do texto, então a saída tem tamanho
      // parecido com a entrada: estimamos por caractere (~3 chars/token em
      // PT-BR) com folga generosa para não truncar parágrafos.
      max_new_tokens: Math.min(MAX_NEW_TOKENS_CAP, Math.ceil((userText.length / 3) * 2) + 256),
      temperature: 0.2,
      do_sample: false,
    });
    const reply = extractReply(output);
    if (!reply) throw new Error("O modelo local não devolveu texto.");
    return reply;
  }

  return { generate };
})();
