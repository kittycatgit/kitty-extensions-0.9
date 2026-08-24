import { type TestLogger } from "@paperback/types";

import { ToonTop } from "../ToonTop/main.js";
import sourceInfo from "../ToonTop/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ToonTop tests", logger);
  registerDefaultTests(suite, ToonTop, sourceInfo);

  await suite.run();
}
