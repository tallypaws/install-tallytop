#!/usr/bin/env node

import os from "os";
import { readChar, TerminalController } from "./terminalController.js";

import * as pencil from "pencil-case";
import path from "path";
import { debounce } from "@thetally/toolbox";

import fs from "fs";
const fsp = fs.promises;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const defaultBinDir = `${os.homedir()}/.local/bin`;
const defaultDesktopEntryDir = `${os.homedir()}/.local/share/applications`;
const defaultIconDir = `${os.homedir()}/.local/share/icons/hicolor/256x256/apps`;

const terminal = new TerminalController();

const terminalWidth = process.stdout.columns;
const headerText = "  Tallytop Installer  ";
const padding = Math.max(
  0,
  Math.floor((terminalWidth - headerText.length) / 2),
);
const header = terminal.line(
  " ".repeat(padding) + headerText + " ".repeat(padding),
);
terminal.line("");

process.stdout.on("resize", () => {
  const newWidth = process.stdout.columns;
  const newPadding = Math.max(
    0,
    Math.floor((newWidth - headerText.length) / 2),
  );
  header(" ".repeat(newPadding) + headerText + " ".repeat(newPadding));
});

const tallytopBinUrl =
  "https://github.com/tallylostctrl/Tallytop/releases/latest/download/Tallytop.AppImage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const localIconPath = path.join(__dirname, "assets", "icon.png");

function gray(text: string) {
  return "\x1b[0;38;5;246;49m" + text + pencil.regular;
}
function green(text: string) {
  return pencil.green + text + pencil.regular;
}
function red(text: string) {
  return pencil.red + text + pencil.regular;
}

function yellow(text: string) {
  return pencil.yellow + text + pencil.regular;
}

function normalizePath(p: string) {
  if (!p.endsWith(path.sep)) {
    return p + path.sep;
  }
  return p;
}

const pathEnteries = new Set(
  process.env.PATH
    ? process.env.PATH.split(path.delimiter).map(normalizePath)
    : [],
);

async function promptForDirectory(
  defaultDir: string,
  promptText: string,
  checkInPath: boolean = false,
  fileToCheck: string | null = null,
): Promise<{ resolvedPath: string; promptLine: any }> {
  const pathPromptLine = terminal.line(gray(promptText + ":"));
  const pathInputLine = terminal.line("  ");
  const pathInfoLine = terminal.multiline("  ");

  let dir = "";
  let resolvedPath = defaultDir;
  let validPath:
    | "yes"
    | "notWritable"
    | "fileExists"
    | "loading"
    | "notInPath" = "loading";

  let timeoutId: NodeJS.Timeout | null = null;
  let cursorPos = 0;
  let cursorVisible = false;

  function renderInput(typed = true) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      renderInput(false);
    }, 1000);
    const text = dir;
    let info: string[] = [];
    const leadColor =
      validPath === "loading"
        ? pencil.regular
        : validPath === "yes"
          ? pencil.green
          : validPath === "notInPath"
            ? pencil.yellow
            : pencil.red;
    pathInputLine(leadColor + "> " + pencil.regular + text);
    if (dir !== resolvedPath) {
      info.push(resolvedPath ? gray(`  ${resolvedPath}`) : red("invalid path"));
    }

    if (validPath === "notWritable") {
      info.push(red("!") + " Directory is not writable");
    } else if (validPath === "fileExists") {
      info.push(
        yellow("!") +
          ` A file named ${fileToCheck} already exists in this directory\n` +
          gray("(will get overwritten)"),
      );
    } else if (validPath === "yes") {
    } else if (validPath === "notInPath") {
      info.push(
        yellow("!") +
          ` Directory is not in PATH\n ${fileToCheck || "the file"} cant be run from terminal without adding it to PATH\n ${gray("(i mean unless you use the full path)")}`,
      );
    } else {
    }

    pathInfoLine(info.join("\n"));

    if (typed) {
      cursorVisible = true;
    } else {
      cursorVisible = !cursorVisible;
    }

    terminal.afterRender(() => {
      if (cursorVisible) {
        process.stdout.write("\x1b[6 q");
        process.stdout.write("\x1b[?25h");
      } else {
        process.stdout.write("\x1b[?25l");
      }

      terminal.moveCursor(pathInputLine.lineNumber());
      process.stdout.write(`\x1b[${cursorPos + 3}G`);
    });
  }

  let checkRunId = 0;

  async function checkPath() {
    const currentRunId = ++checkRunId;
    if (!resolvedPath) {
      validPath = "loading";
      renderInput(false);
      return;
    }

    const accessible = await fsp
      .access(resolvedPath, fs.constants.W_OK)
      .then(() => true)
      .catch(() => false);

    if (currentRunId !== checkRunId) return;

    if (
      accessible &&
      checkInPath &&
      !pathEnteries.has(normalizePath(resolvedPath))
    ) {
      validPath = "notInPath";
    } else if (accessible) {
      if (fileToCheck) {
        const filePath = path.join(resolvedPath, fileToCheck);
        const fileExists = await fsp
          .access(filePath, fs.constants.F_OK)
          .then(() => true)
          .catch(() => false);

        if (fileExists) {
          validPath = "fileExists";
        } else {
          validPath = "yes";
        }
      } else {
        validPath = "yes";
      }
    } else {
      validPath = "notWritable";
    }
    renderInput(false);
  }

  const checkPathDebounced = debounce(checkPath, 150);

  await checkPath();

  function resolvePath(input: string): string | null {
    if (!input) return defaultDir;

    let p = input.trim();
    if (!p) return defaultDir;

    if (p.startsWith("~")) {
      p = path.join(os.homedir(), p.slice(1));
    }

    p = path.resolve(p);

    return p;
  }

  checkPathDebounced();

  function setDir(dirInput: string) {
    dir = dirInput;
    resolvedPath = resolvePath(dir) || "";
    validPath = "loading";
    checkPathDebounced();
    renderInput();
  }

  setImmediate(() => {
    renderInput();
  });

  while (true) {
    const char = await readChar();

    if (char === "\r") {
      if (validPath !== "loading" && validPath !== "notWritable") {
        break;
      }
    } else if (char === "\u0003") {
      terminal.destroy();
      process.exit();
    } else if (char === "\u007F") {
      if (cursorPos > 0) {
        setDir(dir.slice(0, cursorPos - 1) + dir.slice(cursorPos));
        cursorPos--;
      }
    } else if (char === "\u001b[D") {
      if (cursorPos > 0) cursorPos--;
    } else if (char === "\u001b[C") {
      if (cursorPos < dir.length) cursorPos++;
    } else {
      setDir(dir.slice(0, cursorPos) + char + dir.slice(cursorPos));
      cursorPos++;
    }

    renderInput();
  }

  if (timeoutId) clearTimeout(timeoutId);

  pathInputLine.remove();
  pathInfoLine.remove();
  const color =
    validPath === "yes"
      ? green
      : validPath === "notInPath" || validPath === "fileExists"
        ? yellow
        : red;

  pathPromptLine(promptText + ":" + color(` ${resolvedPath} `));

  return { resolvedPath, promptLine: pathPromptLine };
}

const { resolvedPath, promptLine: binPromptLine } = await promptForDirectory(
  defaultBinDir,
  "Bin installation directory",
  true,
  "tallytop",
);

let gap = terminal.line("");

const { resolvedPath: desktopResolvedPath, promptLine: desktopPromptLine } =
  await promptForDirectory(
    defaultDesktopEntryDir,
    "Desktop entry directory",
    false,
    "Tallytop.desktop",
  );

gap.remove();
gap = terminal.line("");

const { resolvedPath: iconResolvedPath, promptLine: iconPromptLine } =
  await promptForDirectory(
    defaultIconDir,
    "App icon directory",
    false,
    "tallytop.png",
  );

gap.remove();
terminal.line("");

import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { fileURLToPath } from "node:url";

async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (progress: number) => void,
) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Unexpected response ${response.statusText}`);

  const contentLength = parseInt(
    response.headers.get("content-length") || "0",
    10,
  );
  let downloadedBytes = 0;

  const progressStream = new Transform({
    transform(chunk, encoding, callback) {
      downloadedBytes += chunk.length;
      const progress = contentLength
        ? ((downloadedBytes / contentLength) * 100).toFixed(1)
        : -1;
      onProgress?.(progress as any);
      callback(null, chunk);
    },
  });

  const writer = fs.createWriteStream(destPath);
  await pipeline(Readable.from(response.body!), progressStream, writer);
  process.stdout.write("\n");
}

function bar(length: number, progress: number) {
  if (progress < 0) progress = 0;
  if (progress > 1) progress = 1;

  const filledLength = Math.floor(progress * length);
  const emptyLength = length - filledLength;

  let bar = "[";

  for (let i = 0; i < filledLength; i++) {
    if (i === filledLength - 1) {
      bar += ">";
    } else {
      bar += "=";
    }
  }
  for (let i = 0; i < emptyLength; i++) {
    bar += " ";
  }

  bar += "]";

  return bar;
}

const downloadLine = terminal.line("Downloading Tallytop...");
const progressLine = terminal.line(bar(process.stdout.columns - 10, 0) + " 0%");

const tempFilePath = path.join(resolvedPath!, "tallytop_download");

try {
  await downloadFile(tallytopBinUrl, tempFilePath, (progress) => {
    progressLine(
      bar(process.stdout.columns - 10, progress / 100) + ` ${progress}%`,
    );
  });

  const destPath = path.join(resolvedPath!, "tallytop");
  await fsp.rename(tempFilePath, destPath);
  await fsp.chmod(destPath, 0o755);
} catch (error) {
  terminal.multiline(
    red("Failed to download Tallytop: " + (error as Error).message),
  );
  process.exit(1);
}

downloadLine.remove();
progressLine.remove();

binPromptLine(green("Bin installed to ") + resolvedPath);

await wait(150);

const iconDestPath = path.join(iconResolvedPath, "tallytop.png");

const iconLine = terminal.line("Copying app icon...");

try {
  await fsp.copyFile(localIconPath, iconDestPath);
} catch (error) {
  terminal.multiline(
    red("Failed to copy app icon: " + (error as Error).message),
  );
  process.exit(1);
}

iconLine.remove();

iconPromptLine(green("App icon copied to ") + iconDestPath);

await wait(150);

const desktopEntryLine = terminal.line("Creating desktop entry...");

// jamie paige is goated with the sauce
// watch her bust it down sexual-style

const desktopEntryContent = `
[Desktop Entry]
Name=Tallytop
Exec=${path.join(resolvedPath!, "tallytop")} %U
Icon=${iconResolvedPath}tallytop.png
Type=Application
Categories=Utility;
Terminal=false
StartupWMClass=tallytop
GenericName=Internet Messenger
Categories=Network;
Keywords=discord;vencord;vesktop;tallycord;electron;chat;
Comment=miaumirrowmiaauuumrrrrrrrr
MimeType=x-scheme-handler/discord
`.trim();

const desktopEntryPath = path.join(desktopResolvedPath!, "Tallytop.desktop");

try {
  await fsp.writeFile(desktopEntryPath, desktopEntryContent, "utf-8");
} catch (error) {
  terminal.multiline(
    red("Failed to create desktop entry: " + (error as Error).message),
  );
  process.exit(1);
}

desktopEntryLine.remove();

desktopPromptLine(green("Desktop entry created at ") + desktopEntryPath);

await wait(150);

terminal.line(green("Installation complete!"));
terminal.multiline(
  gray(
    "You can run Tallytop by executing " +
      green("tallytop") +
      gray(
        " in your terminal or by launching it from your application menu. \n(you may need to log out and back in for the desktop entry to appear)",
      ),
  ),
);

terminal.afterRender(() => {
  terminal.destroy();

  setImmediate(() => {
    process.exit();
  });
});
