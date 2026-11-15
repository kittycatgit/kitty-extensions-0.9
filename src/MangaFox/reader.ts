/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

// The reader ships its page lists in Dean Edwards packed scripts.
function unpack(script: string): string {
  const match = /\}\('(.*)',(\d+),(\d+),'(.*?)'\.split\('\|'\)/s.exec(script);

  if (!match) {
    return "";
  }

  const radix = Number(match[2]);
  const words = match[4]!.split("|");
  const encode = (value: number): string =>
    (value < radix ? "" : encode(Math.floor(value / radix))) +
    (value % radix > 35 ? String.fromCharCode((value % radix) + 29) : (value % radix).toString(36));
  const dictionary = new Map<string, string>();

  for (let index = 0; index < Number(match[3]); index++) {
    dictionary.set(encode(index), words[index] || encode(index));
  }

  return match[1]!.replace(/\\'/g, "'").replace(/\b\w+\b/g, (word) => dictionary.get(word) ?? word);
}

function quoted(list: string | undefined): string[] {
  return (list ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

export type ReaderPage = { pages?: string[]; chapterId?: string; count: number };

// Long-strip chapters print every page in the document (`newImgs`); the rest
// print only the ids the page endpoint wants.
export function parseReaderPage(html: string): ReaderPage {
  const count = Number(/imagecount\s*=\s*(\d+)/.exec(html)?.[1] ?? 0);
  const packed = html.match(/eval\(function\(p,a,c,k,e,d\).*?\.split\('\|'\),0,\{\}\)\)/gs) ?? [];
  const inline = packed.map(unpack).find((script) => script.includes("newImgs"));

  if (inline) {
    return { pages: quoted(/newImgs=\[(.*?)\]/s.exec(inline)?.[1]), count };
  }

  return { chapterId: /chapterid\s*=\s*(\d+)/.exec(html)?.[1], count };
}

// One answer of chapterfun.ashx: the asked page and the one after it.
export function parseReaderCall(script: string): string[] {
  const source = unpack(script);
  const base = /pix="([^"]*)"/.exec(source)?.[1] ?? "";

  return quoted(/pvalue=\[(.*?)\]/.exec(source)?.[1]).map((path) => `${base}${path}`);
}
