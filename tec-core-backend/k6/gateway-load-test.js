import http             from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend }  from 'k6/metrics';

const errorRate      = new Rate('errors');
const healthDuration = new Trend('health_duration');
const docsDuration   = new Trend('docs_duration');

const BASE_URL = __ENV.BASE_URL || 'https://api-gateway-production-6a68.up.railway.app';

export const options = {
  scenarios: {
    normal_load: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m',  target: 20 },
        { duration: '15s', target: 0  },
      ],
    },
    spike_test: {
      executor:  'ramping-vus',
      startTime: '2m',
      stages: [
        { duration: '10s', target: 30 },
        { duration: '20s', target: 30 },
        { duration: '10s', target: 0  },
      ],
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<500'],
    'http_req_failed':   ['rate<0.70'],
    'errors':            ['rate<0.10'],
  },
};

export default function () {
  // ── Health Check ──────────────────────────────────────
  const health = http.get(`${BASE_URL}/health`);
  healthDuration.add(health.timings.duration);

  check(health, {
    'health: status 200 or 429': (r) => r.status === 200 || r.status === 429,
    'health: < 500ms':           (r) => r.timings.duration < 500,
  });

  // مش error لو 429 — ده rate limit مش bug
  if (health.status !== 200 && health.status !== 429) {
    errorRate.add(1);
  } else {
    errorRate.add(0);
  }

  sleep(0.5);

  // ── Swagger Docs ──────────────────────────────────────
  const docs = http.get(`${BASE_URL}/api/docs.json`);
  docsDuration.add(docs.timings.duration);

  check(docs, {
    'docs: status 200': (r) => r.status === 200,
    'docs: < 1s':       (r) => r.timings.duration < 1000,
  });

  sleep(0.5);

  // ── 401 on protected routes (expected) ───────────────
  const auth = http.post(
    `${BASE_URL}/api/v1/payment/create`,
    JSON.stringify({ amount: 1 }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(auth, {
    'auth: returns 401 or 429': (r) => r.status === 401 || r.status === 429,
    'auth: fast':               (r) => r.timings.duration < 500,
  });

  sleep(1);
}
