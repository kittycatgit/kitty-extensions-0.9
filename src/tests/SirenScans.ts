import { type TestLogger } from "@paperback/types";

import { SirenScans } from "../SirenScans/main.js";
import sourceInfo from "../SirenScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("SirenScans tests", logger);
  registerDefaultTests(suite, SirenScans, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "engagement" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["ten-minutes-before-my-engagement-was-annulled-i-remembered-my-past-life"],
    },
  });

  await suite.run();
}
