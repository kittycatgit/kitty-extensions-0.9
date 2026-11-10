/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { type ContentRating } from "@paperback/types";

import { VComicsGeneric } from "../vcomics/main";
import pbconfig from "./pbconfig";

const DOMAIN = "https://kencomics.com";

class KenComicsExtension extends VComicsGeneric {
  domain = DOMAIN;
  name = pbconfig.name;
  contentRating: ContentRating = pbconfig.contentRating;
}

export const KenComics = new KenComicsExtension();
