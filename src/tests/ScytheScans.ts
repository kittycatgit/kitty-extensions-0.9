import { type TestLogger } from "@paperback/types";

import { ScytheScans } from "../ScytheScans/main.js";
import sourceInfo from "../ScytheScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ScytheScans tests", logger);
  registerDefaultTests(suite, ScytheScans, sourceInfo);

  await suite.run();
}
