import { publicAssetUrl, staticGraphUrl } from "./staticMode";

describe("Pages asset URLs", () => {
  it("keeps the repository subpath when PUBLIC_URL is set", () => {
    expect(publicAssetUrl("data/pyrga_graph.json", "/neutreeko-react")).toBe(
      "/neutreeko-react/data/pyrga_graph.json",
    );
    expect(publicAssetUrl("/static/js/main.js", "/neutreeko-react")).toBe(
      "/neutreeko-react/static/js/main.js",
    );
  });

  it("uses same-origin paths for local and Vercel builds", () => {
    expect(publicAssetUrl("data/neutreeko_graph.json", "")).toBe(
      "/data/neutreeko_graph.json",
    );
  });

  it("names the bundled graph after the selected game", () => {
    expect(staticGraphUrl("neutreeko")).toMatch(/\/data\/neutreeko_graph\.json$/);
    expect(staticGraphUrl("pyrga")).toMatch(/\/data\/pyrga_graph\.json$/);
  });
});
