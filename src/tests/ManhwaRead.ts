import { type TestLogger } from "@paperback/types";

import { ManhwaRead } from "../ManhwaRead/main.js";
import sourceInfo from "../ManhwaRead/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ManhwaRead tests", logger);
  registerDefaultTests(suite, ManhwaRead, sourceInfo);

  await suite.run();
}
