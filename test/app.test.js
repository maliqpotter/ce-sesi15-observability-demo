"use strict";

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createServer } = require("../src/app");

const events = [];
let server;
let baseUrl;

before(async () => {
  server = createServer({ logger: (event) => events.push(event) });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("health check returns healthy status and is not logged as application traffic", async () => {
  const initialEventCount = events.length;
  const response = await fetch(`${baseUrl}/healthz`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.status, "ok");
  assert.equal(events.length, initialEventCount);
});

test("normal request returns a request ID and emits structured logs and EMF metrics", async () => {
  const response = await fetch(`${baseUrl}/api/orders`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.ok(response.headers.get("x-request-id"));
  assert.equal(payload.orders.length, 2);
  assert.ok(events.some((event) => event.event === "http_request" && event.route === "/api/orders"));
  assert.ok(events.some((event) => event.event === "cloudwatch_emf" && event.RequestCount === 1));
});

test("slow endpoint has a bounded simulated delay", async () => {
  const response = await fetch(`${baseUrl}/api/slow?ms=5`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.simulated_delay_ms, 5);

  const invalidResponse = await fetch(`${baseUrl}/api/slow?ms=-1`);
  assert.equal(invalidResponse.status, 400);
});

test("error endpoint returns a controlled 500 and emits an error metric", async () => {
  const response = await fetch(`${baseUrl}/api/error`);
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.error, "simulated_failure");
  assert.ok(events.some((event) => event.event === "application_error" && event.error_code === "SIMULATED_FAILURE"));
  assert.ok(events.some((event) => event.event === "cloudwatch_emf" && event.ErrorCount === 1));
});

test("checkout log events can be correlated with an incoming W3C trace ID", async () => {
  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  const response = await fetch(`${baseUrl}/api/checkout`, {
    headers: {
      traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-trace-id"), traceId);
  assert.equal(payload.trace_id, traceId);
  assert.ok(events.some((event) => event.event === "dependency_call" && event.trace_id === traceId));
});
