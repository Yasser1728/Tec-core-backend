import http   from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom Metrics ────────────────────────────────────────
const errorRate       = new Rate('payment_errors');
const createDuration  = new Trend('payment_create_duration');
const historyDuration = new Trend('payment_history_duration');
const successCount    = new Counter('payment_success_count');

// ── Config ────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'https://api-gateway-production-6a68.up.railway.app';
const TOKEN    = __ENV.JWT_TOKEN || '';

// ── Test Scenarios ────────────────────────────────────────
export const options = {
  scenarios: {

    // ── Scenario 1: Normal Load ─────────────────────────
    normal_load: {
      executor:           'ramping-vus',
      startVUs:           0,
      stages: [
        { duration: '30s', target: 10 },  // ramp up
        { duration: '1m',  target: 10 },  // hold
        { duration: '15s', target: 0  },  // ramp down
      ],
      gracefulRampDown:   '10s',
    },

    // ── Scenario 2: Spike Test ──────────────────────────
    spike_test: {
      executor:           'ramping-vus',
      startVUs:           0,
      startTime:          '2m',
      stages: [
        { duration: '10s', target: 50 },  // sudden spike
        { duration: '30s', target: 50 },  // hold spike
        { duration: '10s', target: 0  },  // drop
      ],
    },

    // ── Scenario 3: History Endpoint ────────────────────
    history_load: {
      executor:           'constant-vus',
      vus:                5,
      duration:           '2m',
      startTime:          '30s',
    },
  },

  thresholds: {
    // ── Performance thresholds ─────────────────────────
    'http_req_duration':          ['p(95)<2000'],  // 95% under 2s
    'http_req_duration{name:create}': ['p(95)<3000'],
    'http_req_duration{name:history}': ['p(95)<1000'],
    'payment_errors':             ['rate<0.05'],   // error rate < 5%
    'http_req_failed':            ['rate<0.10'],   // fail rate < 10%
  },
};

// ── Shared Headers ────────────────────────────────────────
const headers = {
  'Content-Type':  'application/json',
  'Authorization': `Bearer ${TOKEN}`,
  'X-Request-ID':  `k6-${Date.now()}`,
};

// ── Scenario: Create Payment ──────────────────────────────
export default function () {
  const scenario = __ENV.K6_SCENARIO_NAME ?? 'normal_load';

  if (scenario === 'history_load') {
    testPaymentHistory();
  } else {
    testCreatePayment();
  }

  sleep(1);
}

function testCreatePayment() {
  const payload = JSON.stringify({
    userId:         '00000000-0000-0000-0000-000000000001',
    amount:         1,
    currency:       'PI',
    payment_method: 'pi',
    metadata:       { test: true, source: 'k6-load-test' },
  });

  const res = http.post(
    `${BASE_URL}/api/v1/payment/create`,
    payload,
    { headers, tags: { name: 'create' } }
  );

  createDuration.add(res.timings.duration);

  const ok = check(res, {
    'create: status 201 or 200': (r) => r.status === 201 || r.status === 200,
    'create: has data':          (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true || body.data !== undefined;
      } catch { return false; }
    },
    'create: response < 3s':     (r) => r.timings.duration < 3000,
  });

  if (!ok) {
    errorRate.add(1);
    console.error(`[CREATE] status=${res.status} body=${res.body?.slice(0, 200)}`);
  } else {
    successCount.add(1);
  }
}

function testPaymentHistory() {
  const res = http.get(
    `${BASE_URL}/api/v1/payments/history?limit=10&sort=desc`,
    { headers, tags: { name: 'history' } }
  );

  historyDuration.add(res.timings.duration);

  const ok = check(res, {
    'history: status 200':   (r) => r.status === 200,
    'history: response < 1s': (r) => r.timings.duration < 1000,
  });

  if (!ok) {
    errorRate.add(1);
    console.error(`[HISTORY] status=${res.status}`);
  }
}

// ── Gateway Health Test ───────────────────────────────────
export function healthCheck() {
  const res = http.get(`${BASE_URL}/health`);
  check(res, {
    'health: status 200': (r) => r.status === 200,
    'health: service ok': (r) => {
      try {
        return JSON.parse(r.body).status === 'ok';
      } catch { return false; }
    },
  });
}
