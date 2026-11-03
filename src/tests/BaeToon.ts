import { type TestLogger } from "@paperback/types";

import { BaeToon } from "../BaeToon/main.js";
import sourceInfo from "../BaeToon/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("BaeToon tests", logger);
  registerDefaultTests(suite, BaeToon, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "serena" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["68516247702284f83417ae87"],
    },
  });

  await suite.run();
}
