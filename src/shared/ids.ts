/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

// The app rejects any id outside `[A-Za-z0-9._-@()[]%?#+=/&:]`, so site slugs
// with quotes, `!` or non-ASCII must be percent-encoded before they are emitted.
const LEFT_ALONE = /[!'()*~]/g;

export function encodeId(raw: string): string {
  return encodeURIComponent(raw).replace(
    LEFT_ALONE,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

export function decodeId(id: string): string {
  return decodeURIComponent(id);
}
