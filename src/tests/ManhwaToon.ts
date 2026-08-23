import { type TestLogger } from "@paperback/types";

import { ManhwaToon } from "../ManhwaToon/main.js";
import sourceInfo from "../ManhwaToon/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ManhwaToon tests", logger);
  registerDefaultTests(suite, ManhwaToon, sourceInfo);

  await suite.run();
}
