import { type TestLogger } from "@paperback/types";

import { SirenScans } from "../SirenScans/main.js";
import sourceInfo from "../SirenScans/pbconfig.js";
import { registerSirenTests } from "./sirenTheme.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "ten-minutes-before-my-engagement-was-annulled-i-remembered-my-past-life";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("SirenScans tests", logger);
  registerDefaultTests(suite, SirenScans, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "engagement" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
    // The newest chapters are coin-locked; the free-chapter test covers the reader.
    chapterProviding: {
      getChapters: false,
      getChapterDetails: false,
    },
  });
  registerSirenTests(suite, SirenScans, SERIES);

  await suite.run();
}
