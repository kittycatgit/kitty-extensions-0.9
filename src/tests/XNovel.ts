import { type TestLogger } from "@paperback/types";

import { XNovel } from "../XNovel/main.js";
import sourceInfo from "../XNovel/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("XNovel tests", logger);
  registerDefaultTests(suite, XNovel, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "harry potter" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["34211"],
    },
  });

  await suite.run();
}
