import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// findBy*/waitFor give up after 1 s by default, which fails correct-but-slow tests on a busy machine or CI runner.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});
