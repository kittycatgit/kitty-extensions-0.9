import { type TestLogger } from "@paperback/types";

import { WebtoonClub } from "../WebtoonClub/main.js";
import sourceInfo from "../WebtoonClub/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("WebtoonClub tests", logger);
  registerDefaultTests(suite, WebtoonClub, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "winter" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["winterfield"],
    },
  });

  await suite.run();
}
