import { type TestLogger } from "@paperback/types";

import { KnoxT } from "../KnoxT/main.js";
import sourceInfo from "../KnoxT/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("KnoxT tests", logger);
  registerDefaultTests(suite, KnoxT, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "dry land" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["dry-land"],
    },
  });

  await suite.run();
}
