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
    gemini: { model: "gemini-2.5-flash", label: "Google Gemini" },
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

  async function callExternalAI(provider, apiKey, model, systemPrompt, userText) {
    const { url, headers, body } = buildRequest(
      provider,
      apiKey,
      model || DEFAULTS[provider].model,
      systemPrompt,
      userText
    );

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let detail = "";
      try {
        const errJson = await res.json();
        detail = errJson.error?.message || errJson.message || JSON.stringify(errJson);
      } catch {
        detail = await res.text();
      }
      throw new Error(`${DEFAULTS[provider].label} respondeu ${res.status}: ${detail}`);
    }

    const json = await res.json();
    const text = extractText(provider, json);
    if (!text.trim()) throw new Error(`${DEFAULTS[provider].label} devolveu uma resposta vazia.`);
    return text.trim();
  }

  return { callExternalAI, DEFAULTS };
})();
