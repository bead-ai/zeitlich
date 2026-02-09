import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Sandbox from "@e2b/code-interpreter";
import { toTree } from "./fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "./.env") });

describe("toTree", () => {
    let sandboxId: string;
    let apiKey: string;

    beforeAll(async () => {
        const E2B_API_KEY = process.env.E2B_API_KEY;
        if (!E2B_API_KEY) {
          throw new Error("E2B_API_KEY is not set in environment variables");
        }
    
        apiKey = E2B_API_KEY;
        const sandbox = await Sandbox.create("at0ab4810e4ak1til08x", { apiKey });
        sandboxId = sandbox.sandboxId;
        
        console.log(`Created sandbox with ID: ${sandboxId}`);
      });
    
      afterAll(async () => {
        if (sandboxId) {
          const sandbox = await Sandbox.connect(sandboxId);
          await sandbox.kill();
          console.log(`Killed sandbox with ID: ${sandboxId}`);
        }
      });

      it('tests toTree', async () => {
        const sandbox = await Sandbox.connect(sandboxId);

        const expectedOutput = `user/
├─ config/
│  ├─ .env
│  └─ config.yml
├─ documents/
│  ├─ notes/
│  │  ├─ meeting-notes.txt
│  │  └─ todo.md
│  └─ reports/
│     └─ q1-2024.md
├─ projects/
│  ├─ api/
│  │  ├─ package.json
│  │  ├─ README.md
│  │  └─ server.js
│  └─ web-app/
│     ├─ index.html
│     ├─ index.js
│     ├─ README.md
│     └─ style.css
├─ .bash_logout
├─ .bashrc
├─ .profile
├─ build.sh
├─ notes.txt
└─ settings.json`;

        const out = await toTree(sandbox);
        
        expect(out).toBe(expectedOutput);
      });
});