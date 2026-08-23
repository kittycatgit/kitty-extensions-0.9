/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating } from "@paperback/types";

import { basePbConfig, customVersion } from "../generic/config";

let pbConfig = basePbConfig;

pbConfig.name = "ManhwaToon";
pbConfig.description = "Extension that pulls content from manhwatoon.me.";
pbConfig.version = customVersion({ increasePrerelease: -13 });
pbConfig.contentRating = ContentRating.ADULT;

export default pbConfig;
