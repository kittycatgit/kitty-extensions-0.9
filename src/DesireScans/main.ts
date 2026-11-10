/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { type ContentRating } from "@paperback/types";

import { KeroGeneric } from "../kero/main";
import pbconfig from "./pbconfig";

const DOMAIN = "https://desirescans.com";

class DesireScansExtension extends KeroGeneric {
  domain = DOMAIN;
  name = pbconfig.name;
  contentRating: ContentRating = pbconfig.contentRating;
}

export const DesireScans = new DesireScansExtension();
