/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

const VOID = new Set(["br", "hr", "img"]);
const KEEP = new Set([
  "p",
  "br",
  "hr",
  "em",
  "i",
  "strong",
  "b",
  "u",
  "s",
  "del",
  "sup",
  "sub",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "img",
  "a",
  "span",
  "div",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "center",
]);

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;");
}

function render(node: AnyNode): string {
  if (node.type === "text") {
    return escapeText(node.data);
  }
  if (node.type !== "tag") {
    return "";
  }

  const name = node.name.toLowerCase();
  const inner = node.children.map((child) => render(child)).join("");
  if (name === "script" || name === "style") {
    return "";
  }
  if (!KEEP.has(name)) {
    return inner;
  }

  const attrs: string[] = [];
  if (name === "img" && node.attribs["src"]) {
    attrs.push(` src="${escapeAttr(node.attribs["src"])}"`);
  }
  if (name === "a" && node.attribs["href"]) {
    attrs.push(` href="${escapeAttr(node.attribs["href"])}"`);
  }
  const style = node.attribs["style"];
  if (style && /text-align|font-style|font-weight|text-decoration/.test(style)) {
    attrs.push(` style="${escapeAttr(style)}"`);
  }

  if (VOID.has(name)) {
    return `<${name}${attrs.join("")}/>`;
  }
  return `<${name}${attrs.join("")}>${inner}</${name}>`;
}

/**
 * Paperback renders a novel chapter with an XML parser, so the output must be a
 * complete, well-formed XHTML document: void tags closed, no named entities,
 * no stray script/style.
 */
export function toXhtmlDocument(fragmentHtml: string, title?: string): string {
  // cheerio decodes entities (including &nbsp;) into literal characters.
  const $ = cheerio.load(fragmentHtml, null, false);
  const body = $.root()
    .contents()
    .toArray()
    .map((node) => render(node))
    .join("");
  const heading = title ? `<h2>${escapeText(title)}</h2>` : "";
  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${heading}${body}</body></html>`;
}
