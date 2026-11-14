/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { SirenGeneric } from "../siren/main";

class SirenScansExtension extends SirenGeneric {
  domain = "https://sirenscans.com";
}

export const SirenScans = new SirenScansExtension();
