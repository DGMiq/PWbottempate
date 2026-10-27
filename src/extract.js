/** Снимает структуру страницы. Функция выполняется внутри браузера. */
export function extractPage(options = {}) {
  const maxText = options.fullText ? Number.MAX_SAFE_INTEGER : options.maxText ?? 80000;
  const maxLinks = options.maxLinks ?? 400;
  const maxImages = options.maxImages ?? 200;
  const maxButtons = options.maxButtons ?? 200;
  const maxHeadings = options.maxHeadings ?? 300;

  const textOf = (value) => (value || "").replace(/\s+/g, " ").trim();

  const abs = (href) => {
    if (!href) return "";
    try {
      return new URL(href, location.href).href;
    } catch {
      return href;
    }
  };

  const metaContent = (selector) =>
    document.querySelector(selector)?.getAttribute("content")?.trim() || "";

  const meta = [...document.querySelectorAll("meta")].map((el) => ({
    name: el.getAttribute("name") || "",
    property: el.getAttribute("property") || "",
    httpEquiv: el.getAttribute("http-equiv") || "",
    charset: el.getAttribute("charset") || "",
    content: (el.getAttribute("content") || "").slice(0, 2000),
  }));

  const pickPrefixed = (items, key, prefix) => {
    const bag = {};
    for (const item of items) {
      const raw = item[key] || "";
      if (raw.toLowerCase().startsWith(prefix)) bag[raw] = item.content;
    }
    return bag;
  };

  const links = [...document.querySelectorAll("a[href]")].map((el) => {
    const href = abs(el.getAttribute("href"));
    let host = "";
    try {
      host = new URL(href).hostname;
    } catch {
      host = "";
    }
    return {
      text: textOf(el.innerText).slice(0, 300),
      href,
      host,
      internal: host === location.hostname,
      rel: el.getAttribute("rel") || "",
      target: el.getAttribute("target") || "",
    };
  });

  const shortenSrc = (src) =>
    src.startsWith("data:") && src.length > 180 ? `${src.slice(0, 180)}…` : src;

  const images = [...document.querySelectorAll("img")].map((el) => ({
    src: shortenSrc(abs(el.currentSrc || el.getAttribute("src") || "")),
    alt: el.getAttribute("alt") || "",
    width: el.naturalWidth || el.width || null,
    height: el.naturalHeight || el.height || null,
  }));

  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")]
    .map((el) => ({
      level: Number(el.tagName.slice(1)),
      text: textOf(el.innerText).slice(0, 400),
    }))
    .filter((item) => item.text);

  const buttonNodes = [
    ...document.querySelectorAll(
      'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]'
    ),
  ];
  const buttons = buttonNodes.map((el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute("type") || "",
    text: textOf(el.innerText || el.value || el.getAttribute("aria-label") || "").slice(0, 300),
    disabled: Boolean(el.disabled || el.getAttribute("aria-disabled") === "true"),
  }));

  const fieldLabel = (el) => {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || "")
        .join(" ");
      if (textOf(label)) return textOf(label).slice(0, 200);
    }
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return textOf(label.innerText).slice(0, 200);
    }
    const parent = el.closest("label");
    if (parent) return textOf(parent.innerText).slice(0, 200);
    return el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
  };

  const forms = [...document.querySelectorAll("form")].map((form) => {
    const fields = [...form.querySelectorAll("input, textarea, select")].map((el) => {
      const tag = el.tagName.toLowerCase();
      const field = {
        tag,
        type: (el.getAttribute("type") || tag).toLowerCase(),
        name: el.getAttribute("name") || "",
        id: el.id || "",
        label: fieldLabel(el),
        placeholder: el.getAttribute("placeholder") || "",
        required: el.required || el.getAttribute("aria-required") === "true",
        disabled: Boolean(el.disabled),
      };
      if (tag === "select") {
        const options = [...el.options].map((option) => textOf(option.text)).filter(Boolean);
        field.optionCount = options.length;
        field.options = options.slice(0, 20);
      }
      return field;
    });
    return {
      action: abs(form.getAttribute("action") || location.href),
      method: (form.getAttribute("method") || "get").toLowerCase(),
      id: form.id || "",
      name: form.getAttribute("name") || "",
      fields,
    };
  });

  const tables = [...document.querySelectorAll("table")].map((table) => {
    const headers = [...table.querySelectorAll("thead th, tr:first-child th")].map((el) =>
      textOf(el.innerText).slice(0, 120)
    );
    return {
      caption: textOf(table.querySelector("caption")?.innerText || "").slice(0, 200),
      headers: headers.slice(0, 30),
      rowCount: table.querySelectorAll("tr").length,
    };
  });

  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].map(
    (script) => {
      const raw = script.textContent || "";
      try {
        return JSON.parse(raw);
      } catch {
        return { parseError: true, raw: raw.slice(0, 2000) };
      }
    }
  );

  const bodyText = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  const words = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;

  let selection = null;
  if (options.selector) {
    try {
      const el = document.querySelector(options.selector);
      selection = el
        ? {
            selector: options.selector,
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxText),
            html: (el.innerHTML || "").slice(0, 20000),
          }
        : { selector: options.selector, error: "Элемент не найден" };
    } catch (error) {
      selection = { selector: options.selector, error: error.message };
    }
  }

  const nav = performance.getEntriesByType("navigation")[0];

  return {
    finalUrl: location.href,
    title: document.title || "",
    lang: document.documentElement.lang || "",
    charset: document.characterSet || "",
    readyState: document.readyState,
    description: metaContent('meta[name="description"]'),
    keywords: metaContent('meta[name="keywords"]'),
    robots: metaContent('meta[name="robots"]'),
    canonical: abs(document.querySelector('link[rel="canonical"]')?.getAttribute("href") || ""),
    themeColor: metaContent('meta[name="theme-color"]'),
    favicon: abs(
      document.querySelector('link[rel="icon"], link[rel="shortcut icon"]')?.getAttribute("href") ||
        ""
    ),
    alternates: [...document.querySelectorAll('link[rel="alternate"]')].map((el) => ({
      href: abs(el.getAttribute("href")),
      hreflang: el.getAttribute("hreflang") || "",
      type: el.getAttribute("type") || "",
    })),
    meta,
    openGraph: pickPrefixed(meta, "property", "og:"),
    twitter: pickPrefixed(meta, "name", "twitter:"),
    jsonLd,
    headingsTotal: headings.length,
    headings: headings.slice(0, maxHeadings),
    linksTotal: links.length,
    links: links.slice(0, maxLinks),
    imagesTotal: images.length,
    images: images.slice(0, maxImages),
    buttonsTotal: buttons.length,
    buttons: buttons.slice(0, maxButtons),
    forms,
    tables,
    iframes: [...document.querySelectorAll("iframe")].slice(0, 50).map((el) => ({
      src: abs(el.getAttribute("src") || ""),
      title: el.getAttribute("title") || "",
    })),
    media: [...document.querySelectorAll("video, audio, source")].slice(0, 50).map((el) => ({
      tag: el.tagName.toLowerCase(),
      src: shortenSrc(abs(el.currentSrc || el.getAttribute("src") || "")),
      type: el.getAttribute("type") || "",
    })),
    stylesheets: [...document.querySelectorAll('link[rel="stylesheet"]')]
      .slice(0, 100)
      .map((el) => el.href),
    scripts: [...document.querySelectorAll("script[src]")].slice(0, 100).map((el) => el.src),
    counts: {
      links: links.length,
      images: images.length,
      buttons: buttons.length,
      forms: forms.length,
      tables: tables.length,
      iframes: document.querySelectorAll("iframe").length,
      scripts: document.scripts.length,
      stylesheets: document.styleSheets.length,
      words,
    },
    text: bodyText.slice(0, maxText),
    textTruncated: bodyText.length > maxText,
    textLength: bodyText.length,
    selection,
    timings: nav
      ? {
          domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
          loadEventMs: Math.round(nav.loadEventEnd),
          transferSize: nav.transferSize || null,
          encodedBodySize: nav.encodedBodySize || null,
        }
      : null,
  };
}
