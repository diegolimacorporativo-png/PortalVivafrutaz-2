import assert from "node:assert/strict";
import test from "node:test";
import { storage } from "../../server/services/storage";
import {
  requireActiveSubscription,
  requireActiveSubscriptionIfPresent,
} from "../../server/modules/billing/subscription.middleware";

function responseRecorder() {
  const response: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return response;
}

function companyRequest() {
  return {
    headers: {},
    path: "/programacao",
    session: { companyId: 73421 },
  } as any;
}

test("weekly order guard allows a company without a configured subscription", async () => {
  const original = storage.getAssinaturaByCompany;
  (storage as any).getAssinaturaByCompany = async () => undefined;
  try {
    const response = responseRecorder();
    let nextCalled = false;
    await requireActiveSubscriptionIfPresent(companyRequest(), response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, undefined);
  } finally {
    (storage as any).getAssinaturaByCompany = original;
  }
});

test("required paid-feature guard still rejects a company without a subscription", async () => {
  const original = storage.getAssinaturaByCompany;
  (storage as any).getAssinaturaByCompany = async () => undefined;
  try {
    const response = responseRecorder();
    let nextCalled = false;
    await requireActiveSubscription(companyRequest(), response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, { error: "Empresa sem assinatura" });
  } finally {
    (storage as any).getAssinaturaByCompany = original;
  }
});

test("weekly order guard allows an active subscription", async () => {
  const original = storage.getAssinaturaByCompany;
  (storage as any).getAssinaturaByCompany = async () => ({ status: "ativa" });
  try {
    const response = responseRecorder();
    let nextCalled = false;
    await requireActiveSubscriptionIfPresent(companyRequest(), response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, undefined);
  } finally {
    (storage as any).getAssinaturaByCompany = original;
  }
});

for (const status of ["suspensa", "cancelada", "inadimplente"]) {
  test(`weekly order guard rejects an explicitly ${status} subscription`, async () => {
    const original = storage.getAssinaturaByCompany;
    (storage as any).getAssinaturaByCompany = async () => ({ status });
    try {
      const response = responseRecorder();
      let nextCalled = false;
      await requireActiveSubscriptionIfPresent(companyRequest(), response, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false);
      assert.equal(response.statusCode, 403);
      assert.deepEqual(response.body, { error: "Assinatura inativa", status });
    } finally {
      (storage as any).getAssinaturaByCompany = original;
    }
  });
}
