import { type TestLogger } from "@paperback/types";

import { SilentQuill } from "../SilentQuill/main.js";
import sourceInfo from "../SilentQuill/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("SilentQuill tests", logger);
  registerDefaultTests(suite, SilentQuill, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "hero" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["doing-secret-things-with-the-holy-maidens"],
    },
  });

  await suite.run();
}
