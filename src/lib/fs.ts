import type { Sandbox } from "e2b";

const basename = (path: string, separator: string): string => {
  if (path[path.length - 1] === separator) path = path.slice(0, -1);
  const lastSlashIndex = path.lastIndexOf(separator);
  return lastSlashIndex === -1 ? path : path.slice(lastSlashIndex + 1);
};

const printTree = async (
  tab = "",
  children: ((tab: string) => Promise<string | null>)[]
): Promise<string> => {
  let str = "";
  let last = children.length - 1;
  for (; last >= 0; last--) if (children[last]) break;
  for (let i = 0; i <= last; i++) {
    const fn = children[i];
    if (!fn) continue;
    const isLast = i === last;
    const child = await fn(tab + (isLast ? " " : "│") + "  ");
    const branch = child ? (isLast ? "└─" : "├─") : "│";
    str += "\n" + tab + branch + (child ? " " + child : "");
  }
  return str;
};

export const toTree = async (
  sandbox: Sandbox,
  opts: {
    dir?: string;
    separator?: "/" | "\\";
    depth?: number;
    tab?: string;
    sort?: boolean;
  } = {}
): Promise<string> => {
  const separator = opts.separator || "/";
  // Convert ~ to /home/user for the sandbox path
  const dir = opts.dir || "~";
  const actualPath = dir === "~" ? "/home/user" : dir.replace(/^~/, "/home/user");
  
  const tab = opts.tab || "";
  const depth = opts.depth ?? 10;
  const sort = opts.sort ?? true;
  let subtree = " (...)";
  
  if (depth > 0) {
    const list = await sandbox.files.list(actualPath);
    
    if (sort) {
      list.sort((a, b) => {
        const aIsDir = a.type === "dir";
        const bIsDir = b.type === "dir";
        
        if (aIsDir && bIsDir) {
          return a.name.localeCompare(b.name);
        } else if (aIsDir) {
          return -1;
        } else if (bIsDir) {
          return 1;
        } else {
          return a.name.localeCompare(b.name);
        }
      });
    }
    
    subtree = await printTree(
      tab,
      list.map((entry) => async (tab): Promise<string | null> => {
        if (entry.type === "dir") {
          return toTree(sandbox, {
            dir: entry.path,
            depth: depth - 1,
            tab,
          });
        } else if (entry.symlinkTarget) {
          return `${entry.name} → ${entry.symlinkTarget}`;
        } else {
          return entry.name;
        }
      })
    );
  }
  
  const base = basename(actualPath, separator) + separator;
  return base + subtree;
};
