/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import aesjs from "aes-js";

// Constants lifted from the site's reader bundle.
const LIST_XOR_KEY = "/fuCkYou!!!";
const PATH_XOR_KEY = "202508055d0db38bae2e86cc41649f90";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export type SoraImageRow = { order: number; b?: string; d?: string; t?: string; p?: string };

function base64UrlToBytes(input: string): Uint8Array {
  const clean = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let n = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

function xorWith(bytes: Uint8Array, key: string): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i]! ^ key.charCodeAt(i % key.length);
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToUtf8(bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return Application.arrayBufferToUTF8String(copy.buffer);
}

/** `{d}` from the image API → sorted rows of per-host encrypted paths. */
export function decodeImageList(payload: string): SoraImageRow[] {
  const text = bytesToUtf8(xorWith(base64UrlToBytes(payload), LIST_XOR_KEY)).replace(
    /^[﻿\0]+|\0+$/g,
    "",
  );
  const rows = JSON.parse(text) as SoraImageRow[];
  return rows.sort((a, b) => a.order - b.order);
}

/** One encrypted path → the plain path to append to the host. */
export function decryptImagePath(encrypted: string, uuidHex: string): string {
  const mixed = xorWith(base64UrlToBytes(encrypted), PATH_XOR_KEY);
  const iv = mixed.subarray(0, 16);
  const cipherText = mixed.subarray(16);
  const ctr = new aesjs.ModeOfOperation.ctr(hexToBytes(uuidHex), new aesjs.Counter(iv));
  return bytesToUtf8(ctr.decrypt(cipherText)).replace(/\0+$/g, "");
}
