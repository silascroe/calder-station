(() => {
  // Temporary display-name compatibility layer. The persistent simulation keeps
  // its legacy internal identity until the town name and history are finalized.
  const replacements = [
    ["Rookwood Hall", "Calder Hall"],
    ["ROOKWOOD", "CALDER STATION"],
    ["Rookwood", "Calder Station"],
  ];

  function replaceLegacyTownNames(value) {
    let result = String(value ?? "");
    for (const [legacy, current] of replacements) {
      result = result.replaceAll(legacy, current);
    }
    return result;
  }

  function rewriteTextNode(node) {
    const current = node.nodeValue ?? "";
    const next = replaceLegacyTownNames(current);
    if (next !== current) node.nodeValue = next;
  }

  function rewriteElement(element) {
    for (const attribute of ["aria-label", "title", "alt"]) {
      if (!element.hasAttribute?.(attribute)) continue;
      const current = element.getAttribute(attribute);
      const next = replaceLegacyTownNames(current);
      if (next !== current) element.setAttribute(attribute, next);
    }

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      rewriteTextNode(textNode);
      textNode = walker.nextNode();
    }

    element.querySelectorAll?.("[aria-label], [title], [alt]").forEach((child) => {
      for (const attribute of ["aria-label", "title", "alt"]) {
        if (!child.hasAttribute(attribute)) continue;
        const current = child.getAttribute(attribute);
        const next = replaceLegacyTownNames(current);
        if (next !== current) child.setAttribute(attribute, next);
      }
    });
  }

  function rewriteNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      rewriteTextNode(node);
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) rewriteElement(node);
  }

  function start() {
    rewriteElement(document.documentElement);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          rewriteTextNode(mutation.target);
          continue;
        }
        mutation.addedNodes.forEach(rewriteNode);
      }
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
