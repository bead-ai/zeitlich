import type { IFileSystem } from "just-bash";

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
  fs: IFileSystem,
  opts: {
    dir?: string;
    separator?: "/" | "\\";
    depth?: number;
    tab?: string;
    sort?: boolean;
  } = {}
): Promise<string> => {
  const separator = opts.separator || "/";
  let dir = opts.dir || separator;
  if (dir[dir.length - 1] !== separator) dir += separator;
  const tab = opts.tab || "";
  const depth = opts.depth ?? 10;
  const sort = opts.sort ?? true;
  let subtree = " (...)";
  if (depth > 0) {
    const list = (await fs.readdirWithFileTypes?.(dir)) || [];
    if (sort) {
      list.sort((a, b) => {
        if (a.isDirectory && b.isDirectory) {
          return a.name.toString().localeCompare(b.name.toString());
        } else if (a.isDirectory) {
          return -1;
        } else if (b.isDirectory) {
          return 1;
        } else {
          return a.name.toString().localeCompare(b.name.toString());
        }
      });
    }
    subtree = await printTree(
      tab,
      list.map((entry) => async (tab): Promise<string | null> => {
        if (entry.isDirectory) {
          return toTree(fs, {
            dir: dir + entry.name,
            depth: depth - 1,
            tab,
          });
        } else if (entry.isSymbolicLink) {
          return (
            "" + entry.name + " → " + (await fs.readlink(dir + entry.name))
          );
        } else {
          return "" + entry.name;
        }
      })
    );
  }
  const base = basename(dir, separator) + separator;
  return base + subtree;
};
