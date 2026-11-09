/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import aesjs from "aes-js";

// The site encrypts a chapter's page list with AES-256-GCM and hands the key out
// from /api/chapter-crypto. GCM is counter mode under the hood, so the payload is
// read with CTR starting at the second block. The tag is not recomputed: a wrong
// key yields garbage that fails to parse, which is the same outcome.

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64UrlToBytes(input: string): Uint8Array {
  const clean = input
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[^A-Za-z0-9\-_]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let n = 0;

  for (const ch of clean) {
    const index = B64URL.indexOf(ch);
    if (index < 0) {
      throw new Error("The chapter payload is not valid base64url");
    }

    acc = (acc << 6) | index;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }

  return out.subarray(0, n);
}

function bytesToUtf8(bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);

  return Application.arrayBufferToUTF8String(copy.buffer);
}

/**
 * Decrypts an `enc:v1:<keyId>:<nonce>:<tag>:<ciphertext>` chapter payload.
 * @param keys the keys this access token holds, by key id
 */
export function decryptEncV1(payload: string, keys: Record<string, string>): string {
  const parts = payload.split(":");

  if (parts.length !== 6 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("The chapter payload is not in the enc:v1 format");
  }

  const keyId = parts[2]!;
  const key = keys[keyId];

  if (!key) {
    throw new Error(`The site encrypted the chapter with a key it did not hand out (${keyId})`);
  }

  const keyBytes = base64UrlToBytes(key);
  const nonce = base64UrlToBytes(parts[3]!);

  if (keyBytes.length !== 32 || nonce.length !== 12) {
    throw new Error("The chapter key or nonce is the wrong size");
  }

  // GCM builds its first counter block from the 96 bit nonce as nonce||1 and
  // encrypts that for the tag, so the page data starts one block later.
  const counter = new Uint8Array(16);
  counter.set(nonce, 0);
  counter[15] = 2;

  const cipher = new aesjs.ModeOfOperation.ctr(keyBytes, new aesjs.Counter(counter));

  return bytesToUtf8(cipher.decrypt(base64UrlToBytes(parts[5]!)));
}
