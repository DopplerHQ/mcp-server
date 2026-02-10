import { exec } from "child_process";
import { promisify } from "util";
import * as readline from "readline";

const execAsync = promisify(exec);

export async function promptChoice(
  question: string,
  options: string[],
  defaultIndex: number = 0,
): Promise<number> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Not authenticated. Run 'npx @dopplerhq/mcp-server login' first, or set DOPPLER_TOKEN environment variable.",
    );
  }

  return new Promise((resolve) => {
    let selectedIndex = defaultIndex;
    let renderCount = 0;

    const renderOptions = () => {
      if (renderCount > 0) {
        process.stderr.write(`\x1b[${options.length}A`);
      }
      renderCount++;

      options.forEach((opt, i) => {
        const marker = i === selectedIndex ? "❯" : " ";
        const highlight = i === selectedIndex ? "\x1b[36m" : "\x1b[90m";
        process.stderr.write(`\x1b[2K  ${marker} ${highlight}${opt}\x1b[0m\n`);
      });
    };

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\x1b[?25h");
      process.stdin.removeListener("data", onKeyPress);
    };

    const onKeyPress = (key: string) => {
      if (key === "\x03") {
        cleanup();
        process.exit(0);
      }

      if (key === "\r" || key === "\n") {
        cleanup();
        process.stderr.write("\n");
        resolve(selectedIndex);
        return;
      }

      if (key === "\x1b[A" || key === "k") {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        renderOptions();
      } else if (key === "\x1b[B" || key === "j") {
        selectedIndex = (selectedIndex + 1) % options.length;
        renderOptions();
      }
    };

    process.stderr.write(`${question}\n`);
    renderOptions();
    process.stderr.write("\x1b[?25l");

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onKeyPress);
  });
}

export async function promptToken(): Promise<string | undefined> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    process.stderr.write("Enter your Doppler token: ");

    rl.on("line", (answer) => {
      rl.close();
      const token = answer.trim();
      resolve(token || undefined);
    });
  });
}

export async function copyToClipboard(text: string): Promise<void> {
  const escaped = text.replace(/"/g, '\\"');

  switch (process.platform) {
    case "darwin":
      await execAsync(`printf '%s' "${escaped}" | pbcopy`);
      break;
    case "linux":
      await tryCommands([
        `printf '%s' "${escaped}" | xclip -selection clipboard`,
        `printf '%s' "${escaped}" | xsel --clipboard --input`,
      ]);
      break;
    case "win32":
      await execAsync(`echo|set /p="${text}" | clip`);
      break;
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

async function tryCommands(commands: string[]): Promise<void> {
  for (let i = 0; i < commands.length; i++) {
    try {
      await execAsync(commands[i]);
      return;
    } catch {
      if (i === commands.length - 1) throw new Error("All commands failed");
    }
  }
}

export async function openBrowser(url: string): Promise<void> {
  switch (process.platform) {
    case "darwin":
      await execAsync(`open "${url}"`);
      break;
    case "linux":
      await tryCommands([
        `xdg-open "${url}"`,
        `sensible-browser "${url}"`,
        `x-www-browser "${url}"`,
      ]);
      break;
    case "win32":
      await execAsync(`start "" "${url}"`);
      break;
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}
