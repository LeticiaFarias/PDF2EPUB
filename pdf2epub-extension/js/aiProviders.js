/**
 * aiProviders.js
 * -----------------------------------------------------------------------
 * Adaptadores para chamar APIs externas de IA usando a chave da própria
 * usuária (guardada só no chrome.storage.local, nunca enviada a nenhum
 * servidor meu). Cada provedor tem um formato de requisição/resposta
 * diferente — esse módulo esconde essa diferença atrás de uma função
 * única: callExternalAI(provider, apiKey, model, systemPrompt, userText).
 *
 * IMPORTANTE: isso faz uma chamada de rede para o provedor escolhido.
 * Diferente do resto da extensão, essa parte específica não é 100% local
 * — o texto do trecho enviado para revisão sai do navegador da usuária
 * até a API do provedor escolhido por ela.
 */

const AiProviders = (() => {
  const DEFAULTS = {
    openai: { model: "gpt-4o-mini", label: "OpenAI (GPT)" },
    gemini: { model: "gemini-flash-latest", label: "Google Gemini" },
    deepseek: { model: "deepseek-chat", label: "DeepSeek" },
    anthropic: { model: "claude-haiku-4-5-20251001", label: "Anthropic Claude" },
  };

  function buildRequest(provider, apiKey, model, systemPrompt, userText) {
    switch (provider) {
      case "openai":
        return {
          url: "https://api.openai.com/v1/chat/completions",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: {
            model,
            temperature: 0.2,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userText },
            ],
          },
        };

      case "deepseek":
        return {
          url: "https://api.deepseek.com/chat/completions",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: {
            model,
            temperature: 0.2,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userText },
            ],
          },
        };

      case "anthropic":
        return {
          url: "https://api.anthropic.com/v1/messages",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: {
            model,
            max_tokens: 4096,
            temperature: 0.2,
            system: systemPrompt,
            messages: [{ role: "user", content: userText }],
          },
        };

      case "gemini":
        return {
          url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          headers: { "Content-Type": "application/json" },
          body: {
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userText }] }],
            generationConfig: { temperature: 0.2 },
          },
        };

      default:
        throw new Error(`Provedor desconhecido: ${provider}`);
    }
  }

  function extractText(provider, json) {
    switch (provider) {
      case "openai":
      case "deepseek":
        return json.choices?.[0]?.message?.content ?? "";
      case "anthropic":
        return (json.content || []).map((b) => b.text || "").join("");
      case "gemini":
        return (
          json.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? ""
        );
      default:
        return "";
    }
  }

  const MAX_ATTEMPTS = 4;
  const BASE_DELAY_MS = 1000;

  function isTransientStatus(status) {
    return status === 408 || status === 429 || status >= 500;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function retryDelayMs(attempt, retryAfterHeader) {
    const retryAfter = Number.parseFloat(retryAfterHeader || "");
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 30000);
    const backoff = BASE_DELAY_MS * 2 ** (attempt - 1);
    return Math.min(backoff, 30000) + Math.random() * 250;
  }

  async function readErrorDetail(res) {
    try {
      const errJson = await res.json();
      return errJson.error?.message || errJson.message || JSON.stringify(errJson);
    } catch {
      try {
        return await res.text();
      } catch {
        return res.statusText;
      }
    }
  }

  async function callExternalAI(provider, apiKey, model, systemPrompt, userText, onProgress) {
    const { url, headers, body } = buildRequest(
      provider,
      apiKey,
      model || DEFAULTS[provider].model,
      systemPrompt,
      userText
    );
    const label = DEFAULTS[provider].label;

    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
      } catch (err) {
        // Falha de rede (offline, DNS, timeout): também vale tentar de novo.
        if (attempt >= MAX_ATTEMPTS) throw new Error(`${label}: falha de rede (${err.message}).`);
        const delay = retryDelayMs(attempt);
        onProgress?.(`${label}: falha de rede, tentando de novo em ${Math.round(delay / 1000)}s…`);
        await sleep(delay);
        continue;
      }

      if (!res.ok) {
        const detail = await readErrorDetail(res);
        if (isTransientStatus(res.status) && attempt < MAX_ATTEMPTS) {
          const delay = retryDelayMs(attempt, res.headers.get("retry-after"));
          onProgress?.(
            `${label} respondeu ${res.status}; nova tentativa em ${Math.round(delay / 1000)}s (${attempt}/${MAX_ATTEMPTS - 1})…`
          );
          await sleep(delay);
          continue;
        }
        throw new Error(`${label} respondeu ${res.status}: ${detail}`);
      }

      const json = await res.json();
      const text = extractText(provider, json);
      if (!text.trim()) throw new Error(`${label} devolveu uma resposta vazia.`);
      return text.trim();
    }
  }

  return { callExternalAI, DEFAULTS };
})();
