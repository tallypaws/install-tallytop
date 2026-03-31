import { randomUUID } from "crypto";
import { write, writeFileSync } from "fs";

interface LineEntry {
  id: string;
  text: string;
}

type LineController = ((text: string) => void) & {
  remove(): void;
  insertAbove(text: string): LineController;
  insertBelow(text: string): LineController;
  insertMultilineAbove(text: string): MultilineController;
  insertMultilineBelow(text: string): MultilineController;
  lineNumber(): number;
  text(): string;
  id: string;
};

type MultilineController = ((text: string) => void) & {
  remove(): void;
  insertAbove(text: string): LineController;
  insertBelow(text: string): LineController;
  insertMultilineAbove(text: string): MultilineController;
  insertMultilineBelow(text: string): MultilineController;
  /**
   * returns first line number
   */
  lineNumber(): number;
  lines(): number;
  id: string;
};

export class TerminalController {
  private lines: LineEntry[] = [];
  private rendered: Map<number, string> = new Map();
  private numberOfLinesRendered = 0;
  private destroyed = false;

  private queue: (() => void)[] = [];

  constructor() {
    console.clear();
    process.stdout.write("\x1b[?25l");

    const cleanup = () => {
      this.destroy();
    };

    process.on("exit", cleanup);
    process.on("SIGINT", () => {
      cleanup();
      process.exit();
    });
  }

  moveCursor(row: number) {
    process.stdout.write(`\x1b[${row + 1};1H`);
  }

  private clearLine(index?: number) {
    if (index !== undefined) {
      this.moveCursor(index);
    }
    process.stdout.write("\x1b[2K");
  }

  private renderLine(index: number) {
    if (this.destroyed) return;

    const lineEntry = this.lines[index];
    if (!lineEntry) return;

    const text = lineEntry.text;

    if (this.rendered.get(index) === text) return;

    this.moveCursor(index);
    this.clearLine();
    process.stdout.write(text);

    this.rendered.set(index, text);
  }

  private renderAll() {
    // this.rendered.clear();
    for (let i = 0; i < this.lines.length; i++) {
      this.renderLine(i);
    }
    if (this.lines.length < this.numberOfLinesRendered) {
      for (let i = this.lines.length; i < this.numberOfLinesRendered; i++) {
        this.clearLine(i);
      }
    }
    this.numberOfLinesRendered = this.lines.length;
  }

  private invalidateFrom(index: number) {
    for (const key of this.rendered.keys()) {
      if (key >= index) this.rendered.delete(key);
    }
  }

  line(text = ""): LineController {
    const id = randomUUID();
    const entry = { id, text };
    this.lines.push(entry);
    this.scheduleRender();

    return this.createLineManager(id);
  }

  private createLineManager(lineId: string): LineController {
    const _edit = (newText: string) => {
      const entry = this.lines.find((l) => l.id === lineId);
      if (entry) {
        entry.text = newText;
        // this.renderLine(this.lines.indexOf(entry));
        this.scheduleRender();
      }
    };

    _edit.remove = () => {
      const index = this.lines.findIndex((l) => l.id === lineId);
      if (index < 0) return;

      const entry = this.lines.splice(index, 1)[0];

      this.invalidateFrom(index);

      this.scheduleRender();
    };

    _edit.insertAbove = (text: string) => {
      const index = this.lines.findIndex((l) => l.id === lineId);
      if (index < 0) return;

      const newEntry = { id: randomUUID(), text };
      this.lines.splice(index, 0, newEntry);
      this.invalidateFrom(index);
      this.scheduleRender();
      return this.createLineManager(newEntry.id);
    };

    _edit.insertBelow = (text: string) => {
      const index = this.lines.findIndex((l) => l.id === lineId);
      if (index < 0) return;

      const newEntry = { id: randomUUID(), text };
      this.lines.splice(index + 1, 0, newEntry);
      this.invalidateFrom(index);
      this.scheduleRender();
      return this.createLineManager(newEntry.id);
    };

    _edit.lineNumber = () => {
      return this.lines.findIndex((l) => l.id === lineId);
    };

    _edit.insertMultilineAbove = (text: string) => {
      const index = this.lines.findIndex((l) => l.id === lineId);
      if (index < 0) return;

      const newEntry = { id: randomUUID(), text };
      this.lines.splice(index, 0, newEntry);
      this.invalidateFrom(index);
      this.scheduleRender();
      return this.createMultilineManager(newEntry.id);
    };

    _edit.insertMultilineBelow = (text: string) => {
      const index = this.lines.findIndex((l) => l.id === lineId);
      if (index < 0) return;

      const newEntry = { id: randomUUID(), text };
      this.lines.splice(index + 1, 0, newEntry);
      this.invalidateFrom(index + 1);
      this.scheduleRender();
      return this.createMultilineManager(newEntry.id);
    };

    _edit.id = lineId;

    _edit.text = () => {
      const entry = this.lines.find((l) => l.id === lineId);
      return entry ? entry.text : "";
    };

    return _edit as LineController;
  }

  private createMultilineManager(lineId: string) {
    // const baseLine = this.line();
    const entry = this.lines.find((l) => l.id === lineId);
    if (!entry) throw new Error("Line not found");

    const baseLine = this.createLineManager(lineId);
    let thisLineControllers: LineController[] = [baseLine];

    const _edit = (newText: string) => {
      const entry = this.lines.find((l) => l.id === lineId);
      if (!entry) return;

      const newLines = newText.split("\n");

      const baseIndex = this.lines.findIndex((l) => l.id === lineId);
      if (baseIndex < 0) return;

      if (thisLineControllers.length !== newLines.length) {
        while (thisLineControllers.length > newLines.length) {
          if (thisLineControllers.length === 1) break;
          const lc = thisLineControllers.pop();
          lc?.remove();
        }

        while (thisLineControllers.length < newLines.length) {
          const insertIndex = baseIndex + thisLineControllers.length;

          const newEntry = { id: randomUUID(), text: "" };
          this.lines.splice(insertIndex, 0, newEntry);
          this.invalidateFrom(insertIndex);

          thisLineControllers.push(this.createLineManager(newEntry.id));
        }
      }

      for (let i = 0; i < thisLineControllers.length; i++) {
        thisLineControllers[i](newLines[i]);
      }
      // writeFileSync(
      //   "debug.txt",
      //   thisLineControllers.map((lc) => `${lc.id}: ${lc.text()}`).join("\n") +
      //     "\n\n" +
      //     newLines.join("\n") +
      //     "\n\n" +
      //     this.lines.map((l) => `${l.id}: ${l.text}`).join("\n") +
      //     "\n\n" +
      //     this.numberOfLinesRendered,
      // );
    };

    _edit.remove = () => {
      thisLineControllers.forEach((lc) => lc.remove());
    };

    _edit.insertAbove = (text: string) => {
      const newEntry = { id: randomUUID(), text };
      const index = this.lines.findIndex((l) => l.id === lineId);
      if (index < 0) return;

      this.lines.splice(index, 0, newEntry);
      this.invalidateFrom(index);
      this.scheduleRender();
      return this.createLineManager(newEntry.id);
    };

    _edit.insertBelow = (text: string) => {
      const newEntry = { id: randomUUID(), text };
      const index = this.lines.findIndex((l) => l.id === lineId);
      if (index < 0) return;

      this.lines.splice(index + 1, 0, newEntry);
      this.invalidateFrom(index + 1);

      this.scheduleRender();
      return this.createLineManager(newEntry.id);
    };

    _edit.insertMultilineAbove = (text: string) => {
      const newEntry = { id: randomUUID(), text };
      const index = this.lines.findIndex((l) => l.id === lineId);
      if (index < 0) return;

      this.lines.splice(index, 0, newEntry);
      this.invalidateFrom(index);
      this.scheduleRender();
      return this.createMultilineManager(newEntry.id);
    };

    _edit.insertMultilineBelow = (text: string) => {
      const newEntry = { id: randomUUID(), text };
      const index = this.lines.findIndex((l) => l.id === lineId);
      if (index < 0) return;

      this.lines.splice(index + 1, 0, newEntry);
      this.invalidateFrom(index + 1);
      this.scheduleRender();
      return this.createMultilineManager(newEntry.id);
    };

    _edit.lineNumber = () => {
      return this.lines.findIndex((l) => l.id === lineId);
    };

    _edit.lines = () => {
      return thisLineControllers.length;
    };

    _edit.id = lineId;

    return _edit as MultilineController;
  }

  edit(id: string, text: string) {
    const entry = this.lines.find((l) => l.id === id);
    if (entry) {
      entry.text = text;
      this.renderLine(this.lines.indexOf(entry));
    }
  }

  remove(id: string) {
    const index = this.lines.findIndex((l) => l.id === id);
    if (index < 0) return;

    const entry = this.lines.splice(index, 1)[0];
    this.moveCursor(this.lines.length);
    this.clearLine();

    this.scheduleRender();
  }

  clear() {
    this.lines = [];
    this.rendered.clear();
    process.stdout.write("\x1b[2J\x1b[H");
  }

  render() {
    process.stdout.write("\x1b[H");
    this.renderAll();

    while (this.queue.length > 0) {
      const fn = this.queue.shift();
      if (fn) fn();
    }

    // writeFileSync(
    //   "./debug_render.txt",
    //   this.numberOfLinesRendered +
    //     "\n" +
    //     this.lines.map((l) => l.text).join("\n"),
    // );
  }

  afterRender(fn: () => void) {
    this.queue.push(fn);
    this.scheduleRender();
  }

  private pending = false;

  private scheduleRender() {
    if (this.pending) return;
    this.pending = true;

    setImmediate(() => {
      this.pending = false;
      this.render();
    });
  }

  destroy( ) {
    this.moveCursor(this.lines.length);
    process.stdout.write("\n");
    this.destroyed = true;
    this.showCursor();

  }

  showCursor() {
    process.stdout.write("\x1b[?25h");
  }

  hideCursor() {
    process.stdout.write("\x1b[?25l");
  }

  multiline(text: string) {
    const line = this.line(text);
    return this.createMultilineManager(line.id);
  }
}

export function readChar(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;

    if (!stdin.isTTY) {
      throw new Error("readChar requires a TTY");
    }

    const wasRaw = stdin.isRaw;

    stdin.setRawMode(true);
    stdin.resume();

    const onData = (buf: Buffer) => {
      stdin.off("data", onData);

      if (!wasRaw) stdin.setRawMode(false);

      resolve(buf.toString("utf8"));
    };

    stdin.on("data", onData);
  });
}
