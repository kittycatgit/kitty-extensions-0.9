/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { type ContentRating } from "@paperback/types";

import { MeowingGeneric } from "../meowing/main";
import pbconfig from "./pbconfig";

const DOMAIN = "https://kewnscans.org";

class KewnScansExtension extends MeowingGeneric {
  domain = DOMAIN;
  name = pbconfig.name;
  contentRating: ContentRating = pbconfig.contentRating;
}

export const KewnScans = new KewnScansExtension();
