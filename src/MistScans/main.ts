/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { SirenGeneric } from "../siren/main";

class MistScansExtension extends SirenGeneric {
  domain = "https://mistscans.org";
}

export const MistScans = new MistScansExtension();
