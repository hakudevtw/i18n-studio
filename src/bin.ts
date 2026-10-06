#!/usr/bin/env node
import { run } from "./cli.js";

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`error: ${(e as Error).message}\n`);
  process.exitCode = 1;
}
