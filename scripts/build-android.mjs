import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const task = process.argv[2] === "release" ? "assembleRelease" : "assembleDebug";
const isWindows = process.platform === "win32";
const command = isWindows ? process.env.ComSpec || "cmd.exe" : "bash";
const args = isWindows ? ["/d", "/s", "/c", "gradlew.bat", task] : ["gradlew", task];
const androidRoot = path.resolve("android");

const child = spawn(command, args, {
  cwd: androidRoot,
  env: process.env,
  shell: false,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Android build could not start: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
