/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { type ContentRating } from "@paperback/types";

import { LightNovelGeneric } from "../lightnovel/main";
import pbconfig from "./pbconfig";

const DOMAIN = "https://panda-translations.com";

class PandaTranslationsExtension extends LightNovelGeneric {
  domain = DOMAIN;
  name = pbconfig.name;
  contentRating: ContentRating = pbconfig.contentRating;
}

export const PandaTranslations = new PandaTranslationsExtension();
