function section(title) {
  return `\n## ${title}\n`;
}

function lines(items, render, empty = "нет") {
  if (!items?.length) return `${empty}\n`;
  return `${items.map(render).join("\n")}\n`;
}

function clip(value, size = 500) {
  const text = String(value ?? "");
  return text.length > size ? `${text.slice(0, size)}…` : text;
}

export function buildReport(info) {
  const parts = [];
  parts.push("Отчёт о странице");
  parts.push(`Снято: ${info.fetchedAt}`);
  parts.push("");
  parts.push(`Запрошенный URL: ${info.requestedUrl}`);
  parts.push(`Финальный URL: ${info.finalUrl}`);
  parts.push(`Статус: ${info.status ?? "—"} ${info.statusText || ""}`.trim());
  parts.push(`Заголовок: ${info.title || "—"}`);
  parts.push(`Язык: ${info.lang || "—"}`);
  parts.push(`Кодировка: ${info.charset || "—"}`);
  parts.push(`Описание: ${info.description || "—"}`);
  parts.push(`Canonical: ${info.canonical || "—"}`);
  parts.push(`Robots: ${info.robots || "—"}`);
  parts.push(
    `Объём: ссылок ${info.counts.links}, изображений ${info.counts.images}, кнопок ${info.counts.buttons}, форм ${info.counts.forms}, слов ${info.counts.words}`
  );

  if (info.redirects?.length > 1) {
    parts.push(section("Редиректы"));
    parts.push(lines(info.redirects, (url) => `- ${url}`));
  }

  const og = Object.entries(info.openGraph || {});
  const tw = Object.entries(info.twitter || {});
  if (og.length || tw.length || info.alternates?.length) {
    parts.push(section("Open Graph, Twitter и альтернативы"));
    parts.push(lines(og, ([key, value]) => `- ${key}: ${clip(value, 300)}`, "Open Graph нет"));
    if (tw.length) parts.push(lines(tw, ([key, value]) => `- ${key}: ${clip(value, 300)}`));
    if (info.alternates?.length) {
      parts.push(
        lines(info.alternates, (item) => `- ${item.hreflang || item.type || "alternate"}: ${item.href}`)
      );
    }
  }

  parts.push(section("Мета-теги"));
  parts.push(
    lines(
      info.meta,
      (item) =>
        `- ${item.property || item.name || item.httpEquiv || item.charset || "meta"}: ${clip(item.content || item.charset, 300)}`
    )
  );

  parts.push(section("Заголовки"));
  parts.push(
    lines(info.headings, (item) => `${"  ".repeat(item.level - 1)}H${item.level}. ${item.text}`)
  );
  if (info.headingsTotal > info.headings.length) {
    parts.push(`Показано ${info.headings.length} из ${info.headingsTotal}\n`);
  }

  parts.push(section("Ссылки"));
  parts.push(
    lines(info.links, (item) => {
      const where = item.internal ? "внутренняя" : "внешняя";
      const label = item.text || "(без текста)";
      return `- [${where}] ${label} -> ${item.href}`;
    })
  );
  if (info.linksTotal > info.links.length) {
    parts.push(`Показано ${info.links.length} из ${info.linksTotal}\n`);
  }

  parts.push(section("Изображения"));
  parts.push(
    lines(
      info.images,
      (item) => `- ${item.alt || "(без alt)"} | ${item.width || "?"}x${item.height || "?"} | ${item.src}`
    )
  );
  if (info.imagesTotal > info.images.length) {
    parts.push(`Показано ${info.images.length} из ${info.imagesTotal}\n`);
  }

  parts.push(section("Кнопки"));
  parts.push(
    lines(info.buttons, (item) => `- ${item.text || "(без текста)"}${item.disabled ? " [disabled]" : ""}`)
  );

  parts.push(section("Формы"));
  if (!info.forms?.length) parts.push("нет\n");
  else {
    for (const form of info.forms) {
      parts.push(`- ${form.method.toUpperCase()} ${form.action}`);
      for (const field of form.fields) {
        const name = field.label || field.name || field.id || field.type;
        parts.push(`  - ${field.type}: ${name}${field.required ? " *" : ""}`);
      }
    }
    parts.push("");
  }

  parts.push(section("Таблицы"));
  parts.push(
    lines(
      info.tables,
      (table) =>
        `- строк: ${table.rowCount}; колонки: ${table.headers.join(" | ") || "—"}${table.caption ? `; ${table.caption}` : ""}`
    )
  );

  parts.push(section("Фреймы и медиа"));
  const frames = [
    ...(info.iframes || []).map((item) => `- iframe ${item.title || ""} ${item.src}`.trim()),
    ...(info.media || []).map((item) => `- ${item.tag}: ${item.src || "(без src)"}`),
  ];
  parts.push(lines(frames, (item) => item));

  if (info.jsonLd?.length) {
    parts.push(section("JSON-LD"));
    parts.push(clip(JSON.stringify(info.jsonLd, null, 2), 8000));
    parts.push("");
  }

  parts.push(section("Видимый текст"));
  parts.push(info.text || "нет");
  if (info.textTruncated) {
    parts.push(`\nТекст обрезан. Полная длина: ${info.textLength} символов. Повторите запуск с --full-text.`);
  }
  parts.push("");

  if (info.selection) {
    parts.push(section(`Фрагмент ${info.selection.selector}`));
    parts.push(info.selection.error || info.selection.text || "пусто");
    parts.push("");
  }

  parts.push(section("Cookies"));
  parts.push(
    lines(
      info.cookies,
      (cookie) =>
        `- ${cookie.name}=${cookie.value} (domain=${cookie.domain}, path=${cookie.path}, secure=${cookie.secure}, httpOnly=${cookie.httpOnly})`
    )
  );

  parts.push(section("Заголовки ответа"));
  parts.push(
    lines(Object.entries(info.headers || {}), ([key, value]) => `- ${key}: ${clip(value, 300)}`)
  );

  parts.push(section("Консоль браузера"));
  parts.push(lines(info.console, (item) => `- [${item.type}] ${clip(item.text, 400)}`));

  parts.push(section("Сетевые ошибки"));
  const networkIssues = [
    ...(info.failedRequests || []).map((item) => `- ${item.error || "fail"} ${item.url}`),
    ...(info.httpErrors || []).map((item) => `- ${item.status} ${item.url}`),
  ];
  parts.push(lines(networkIssues, (item) => item));

  if (info.timings) {
    parts.push(section("Тайминги"));
    parts.push(`Переход: ${info.timings.navigationMs} мс`);
    if (info.timings.domContentLoadedMs != null) {
      parts.push(`DOMContentLoaded: ${info.timings.domContentLoadedMs} мс`);
    }
    if (info.timings.loadEventMs) parts.push(`Load: ${info.timings.loadEventMs} мс`);
    parts.push("");
  }

  if (info.ariaSnapshot) {
    parts.push(section("Дерево доступности"));
    parts.push(clip(info.ariaSnapshot, 20000));
    parts.push("");
  }

  return `${parts.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
