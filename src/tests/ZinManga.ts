import { type TestLogger } from "@paperback/types";

import { ZinManga } from "../ZinManga/main.js";
import sourceInfo from "../ZinManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ZinManga tests", logger);
  registerDefaultTests(suite, ZinManga, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "wolf" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["wolf-billionaires-sweet-lover"],
    },
  });

  await suite.run();
}
