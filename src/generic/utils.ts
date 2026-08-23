/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function md5Bytes(data: Uint8Array): Uint8Array {
  return hexToBytes(Application.crypto_md5Hash(data.buffer as ArrayBuffer));
}

function deriveKeyAndIv(passphrase: string, salt: Uint8Array) {
  const pass = new TextEncoder().encode(passphrase);
  const out = new Uint8Array(48);
  let block: Uint8Array = new Uint8Array(0);
  let filled = 0;
  while (filled < 48) {
    const input = new Uint8Array(block.length + pass.length + salt.length);
    input.set(block, 0);
    input.set(pass, block.length);
    input.set(salt, block.length + pass.length);
    block = md5Bytes(input);
    out.set(block, filled);
    filled += block.length;
  }
  return { key: out.slice(0, 32), iv: out.slice(32, 48) };
}

export async function decryptData(cipherText: string, passphrase: string) {
  const {
    ct,
    iv: ivHex,
    s: saltHex,
  } = JSON.parse(cipherText) as {
    ct: string;
    iv: string;
    s: string;
  };
  const { key, iv: derivedIv } = deriveKeyAndIv(passphrase, hexToBytes(saltHex));
  const iv = ivHex ? hexToBytes(ivHex) : derivedIv;
  const cipherBuffer = Application.base64Decode(ct) as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, [
    "decrypt",
  ]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, cipherBuffer);
  return JSON.parse(JSON.parse(new TextDecoder().decode(plaintext)));
}

export function extractVariableValues(chapterData: string): Record<string, string> {
  const variableRegex = /var\s+(\w+)\s*=\s*'([^']*)';/g;
  const variables: Record<string, string> = {};
  let match;

  // Under no circumstances directly eval (or Function), as they might go hardy harr-harr sneaky and pull an RCE
  while ((match = variableRegex.exec(chapterData)) !== null) {
    const [, variableName, variableValue] = match as unknown as [string, string, string];
    variables[variableName] = variableValue;
  }

  return variables;
}
