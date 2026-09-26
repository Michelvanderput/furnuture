import { describe, expect, it } from "vitest";
import { normalize } from "@/lib/cloud";

describe("AI server address", () => {
  it("turns a Space page link into its app address", () => {
    expect(normalize("https://huggingface.co/spaces/Michel/furnuture_ai")).toBe("https://michel-furnuture-ai.hf.space");
    expect(normalize("huggingface.co/spaces/a.b/c/")).toBe("https://a-b-c.hf.space");
  });
  it("keeps a direct address", () => {
    expect(normalize("https://me-ai.hf.space/")).toBe("https://me-ai.hf.space");
    expect(normalize("me-ai.hf.space")).toBe("https://me-ai.hf.space");
    expect(normalize("http://localhost:7860")).toBe("http://localhost:7860");
  });
});
