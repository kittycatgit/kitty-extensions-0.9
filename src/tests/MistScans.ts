import { type TestLogger } from "@paperback/types";

import { MistScans } from "../MistScans/main.js";
import sourceInfo from "../MistScans/pbconfig.js";
import { registerSirenTests } from "./sirenTheme.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "yokai-come-to-the-rural-teahouse";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MistScans tests", logger);
  registerDefaultTests(suite, MistScans, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "yokai" }, undefined, undefined],
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
  registerSirenTests(suite, MistScans, SERIES);

  await suite.run();
}
