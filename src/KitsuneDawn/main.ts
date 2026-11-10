/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { type ContentRating } from "@paperback/types";

import { LwComicsGeneric } from "../lwcomics/main";
import pbconfig from "./pbconfig";

const DOMAIN = "https://kitsunedawn.com";

class KitsuneDawnExtension extends LwComicsGeneric {
  domain = DOMAIN;
  name = pbconfig.name;
  contentRating: ContentRating = pbconfig.contentRating;
}

export const KitsuneDawn = new KitsuneDawnExtension();
