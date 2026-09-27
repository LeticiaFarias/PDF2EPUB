// Clicar no ícone da extensão abre o conversor em uma aba própria,
// já que a interface precisa de bastante espaço (upload, opções, prévia).
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});
