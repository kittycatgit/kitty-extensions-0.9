import { type TestLogger } from "@paperback/types";

import { manga3asq } from "../manga3asq/main.js";
import sourceInfo from "../manga3asq/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("manga3asq tests", logger);
  registerDefaultTests(suite, manga3asq, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "one piece" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["berserk"],
    },
  });

  await suite.run();
}
