/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { type ContentRating } from "@paperback/types";

import { MangaBerriGeneric } from "../mangaberri/main";
import pbconfig from "./pbconfig";

const DOMAIN = "https://readmanhwas.com";

class ReadManhwasExtension extends MangaBerriGeneric {
  domain = DOMAIN;
  name = pbconfig.name;
  contentRating: ContentRating = pbconfig.contentRating;
}

export const ReadManhwas = new ReadManhwasExtension();
