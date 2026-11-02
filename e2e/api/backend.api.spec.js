import { test, expect } from "@playwright/test";

const API = "http://localhost:4000";

test.describe("Backend integration", { tag: ["@api"] }, () => {
  test("the backend is up", async ({ request }) => {
    const response = await request.get(`${API}/api/health`);
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).status).toBe("ok");
  });

  test("K5: a request with no sign-in is refused", async ({ request }) => {
    const response = await request.post(`${API}/api/events/any-event/rerequest-arrangements`, { data: {} });
    expect(response.status()).toBe(401);
  });
});