import { type TestLogger } from "@paperback/types";

import { LGBToon } from "../LGBToon/main.js";
import sourceInfo from "../LGBToon/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("LGBToon tests", logger);
  registerDefaultTests(suite, LGBToon, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "winterfield" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["winterfield-695712a1fa29e162ab14ca69"],
    },
  });

  await suite.run();
}
