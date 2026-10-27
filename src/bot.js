import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { extractPage } from "./extract.js";
import { buildReport } from "./report.js";

const HELP = `
Playwright-бот: открывает страницу и собирает о ней информацию.

Использование:
  npm start -- <url> [опции]

Опции:
  --headed           показать окно браузера
  --wait <мс>        подождать после загрузки (для одностраничных сайтов)
  --timeout <мс>     таймаут перехода, по умолчанию 45000
  --selector <css>   дополнительно снять текст выбранного элемента
  --full-text        не обрезать видимый текст
  --out <папка>      куда сохранить отчёт (по умолчанию output/<сайт-дата>)
  -h, --help         эта справка

Пример:
  npm start -- https://example.com
  npm start -- example.com --headed --wait 2000

В папке отчёта будут page.json, report.txt, page.html и page.png.
`.trim();

function parseArgs(argv) {
  const options = {
    url: null,
    headed: false,
    wait: 0,
    timeout: 45000,
    out: null,
    selector: null,
    fullText: false,
    help: false,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Для ${arg} нужно значение`);
      }
      i += 1;
      return value;
    };

    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--headed":
        options.headed = true;
        break;
      case "--full-text":
        options.fullText = true;
        break;
      case "--wait":
        options.wait = Number(next());
        break;
      case "--timeout":
        options.timeout = Number(next());
        break;
      case "--out":
        options.out = next();
        break;
      case "--selector":
        options.selector = next();
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`Неизвестный аргумент: ${arg}`);
        positional.push(arg);
    }
  }

  if (positional.length > 1) throw new Error("Укажите один URL");
  options.url = positional[0] ?? null;

  if (Number.isNaN(options.wait) || options.wait < 0) throw new Error("--wait должен быть числом миллисекунд");
  if (Number.isNaN(options.timeout) || options.timeout < 1000) {
    throw new Error("--timeout должен быть числом миллисекунд, минимум 1000");
  }
  return options;
}

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withProtocol).href;
}

function outputDir(url, explicit) {
  if (explicit) return path.resolve(explicit);
  const host = new URL(url).hostname.replace(/[^a-z0-9.-]+/gi, "_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve("output", `${host}_${stamp}`);
}

function redirectChain(response) {
  const chain = [];
  let request = response?.request();
  while (request) {
    chain.push(request.url());
    request = request.redirectedFrom();
  }
  return chain.reverse();
}

async function inspect(options) {
  const started = Date.now();
  const browser = await chromium.launch({ headless: !options.headed });
  const context = await browser.newContext({
    locale: "ru-RU",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  const consoleMessages = [];
  const failedRequests = [];
  const httpErrors = [];

  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
  page.on("console", (message) => {
    if (consoleMessages.length >= 100) return;
    consoleMessages.push({ type: message.type(), text: message.text() });
  });
  page.on("requestfailed", (request) => {
    if (failedRequests.length >= 100) return;
    failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText || "failed",
    });
  });
  page.on("response", (response) => {
    if (response.status() < 400 || httpErrors.length >= 100) return;
    httpErrors.push({ url: response.url(), status: response.status() });
  });

  try {
    const response = await page.goto(options.url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeout,
    });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    if (options.wait) await page.waitForTimeout(options.wait);
    if (options.selector) {
      await page.waitForSelector(options.selector, { timeout: Math.min(options.timeout, 10000) }).catch(() => {});
    }

    const pageInfo = await page.evaluate(extractPage, {
      fullText: options.fullText,
      selector: options.selector,
    });
    const headers = response ? await response.allHeaders() : {};
    const cookies = await context.cookies();
    let ariaSnapshot = "";
    try {
      ariaSnapshot = await page.locator("body").ariaSnapshot();
    } catch {
      ariaSnapshot = "";
    }

    const info = {
      fetchedAt: new Date().toISOString(),
      requestedUrl: options.url,
      status: response?.status() ?? null,
      statusText: response?.statusText() ?? "",
      redirects: redirectChain(response),
      headers,
      cookies,
      console: consoleMessages,
      failedRequests,
      httpErrors,
      ariaSnapshot: ariaSnapshot.length > 50000 ? `${ariaSnapshot.slice(0, 50000)}…` : ariaSnapshot,
      ...pageInfo,
      timings: {
        navigationMs: Date.now() - started,
        ...(pageInfo.timings || {}),
      },
    };

    const dir = outputDir(options.url, options.out);
    fs.mkdirSync(dir, { recursive: true });
    const html = await page.content();
    fs.writeFileSync(path.join(dir, "page.html"), html, "utf8");
    fs.writeFileSync(path.join(dir, "page.json"), JSON.stringify(info, null, 2), "utf8");
    fs.writeFileSync(path.join(dir, "report.txt"), buildReport(info), "utf8");

    const screenshotPath = path.join(dir, "page.png");
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch {
      await page.screenshot({ path: screenshotPath, fullPage: false });
    }

    return { info, dir };
  } finally {
    await browser.close();
  }
}

function printSummary(info, dir) {
  console.log("");
  console.log(info.title || "(без заголовка)");
  console.log(info.finalUrl);
  console.log(`Статус: ${info.status ?? "—"} ${info.statusText || ""}`.trim());
  console.log(
    `Ссылок: ${info.counts.links}, изображений: ${info.counts.images}, кнопок: ${info.counts.buttons}, форм: ${info.counts.forms}, слов: ${info.counts.words}`
  );
  if (info.textTruncated) console.log("Текст в отчёте обрезан. Для полного текста добавьте --full-text.");
  console.log("");
  console.log("Файлы:");
  for (const name of ["report.txt", "page.json", "page.html", "page.png"]) {
    console.log(`  ${path.join(dir, name)}`);
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error("");
    console.error(HELP);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(HELP);
    return;
  }
  if (!options.url) {
    console.error("Укажите адрес страницы.");
    console.error("");
    console.error(HELP);
    process.exitCode = 1;
    return;
  }

  try {
    options.url = normalizeUrl(options.url);
  } catch {
    console.error(`Некорректный URL: ${options.url}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Открываю ${options.url}`);
  try {
    const { info, dir } = await inspect(options);
    printSummary(info, dir);
  } catch (error) {
    const missingBrowser = /Executable doesn't exist|browserType\.launch|Please run the following command/i.test(
      error.message || ""
    );
    if (missingBrowser) {
      console.error("Chromium для Playwright не установлен.");
      console.error("Выполните: npm run install-browser");
    } else {
      console.error(`Не удалось открыть страницу: ${error.message}`);
    }
    process.exitCode = 1;
  }
}

main();
