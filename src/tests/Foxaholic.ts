import { type TestLogger } from "@paperback/types";

import { Foxaholic } from "../Foxaholic/main.js";
import sourceInfo from "../Foxaholic/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Foxaholic tests", logger);
  registerDefaultTests(suite, Foxaholic, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "rebirth" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["a-scumbag-always-gets-what-he-deserves"],
    },
  });

  await suite.run();
}
