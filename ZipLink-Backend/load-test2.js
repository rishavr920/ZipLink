import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import {
  randomItem,
  uuidv4,
} from "https://jslib.k6.io/k6-utils/1.4.0/index.js";
import papaparse from "https://jslib.k6.io/papaparse/5.1.1/index.js";

export let options = {
  vus: 150,
  duration: "1m",
};

// Store old URLs for reuse simulation
let existingUrls = new SharedArray("existing", function () {
  return [
    "https://google.com/old1",
    "https://github.com/old2",
    "https://chat.openai.com/old3",
  ];
});

const BASE_URL = "http://127.0.0.1:8000";

export default function () {
  const useNew = Math.random() < 0.7; // 70% new, 30% reused

  const OriginalUrl = useNew
    ? `https://google.com/${uuidv4()}`
    : randomItem(existingUrls);

  // Step 1: Shorten URL
  const payload = JSON.stringify({
    OriginalUrl,
    Password: "test123",
    OneTime: false,
    ExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const params = { headers: { "Content-Type": "application/json" } };
  const shortenRes = http.post(`${BASE_URL}/url/p`, payload, params);
  check(shortenRes, { "Shorten URL success": (r) => r.status === 201 });

  const shortURL = shortenRes.json()?.data?.ShortURL || "";
  const identifier = shortURL.split("/").pop();

  // Step 2: Access shortened URL (to trigger Redis caching or password page)
  if (identifier) {
    const getRes = http.get(`${BASE_URL}/url/${identifier}`, {
      redirects: 0,
    });
    check(getRes, {
      "URL Get 200 or 302": (r) => [200, 302, 410].includes(r.status),
    });
  }

  // Step 3: Search URL
  const searchPayload = JSON.stringify({ OriginalUrl });
  const searchRes = http.post(`${BASE_URL}/url/search`, searchPayload, params);
  check(searchRes, {
    "Search success": (r) => r.status === 200 || r.status === 404,
  });

  //   Step 4: Password submission (simulate correct one)
  if (identifier) {
    const formRes = http.post(
      `${BASE_URL}/url/${identifier}`,
      `password=test123`,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );
    check(formRes, {
      "Password submit response": (r) => [302, 401, 404].includes(r.status),
    });
  }

  // Step 5: Randomly test deletion
  if (Math.random() < 0.05 && identifier) {
    const delRes = http.del(`${BASE_URL}/url/del/${identifier}`);
    check(delRes, {
      "Individual delete status": (r) => [200, 404].includes(r.status),
    });
  }

  // Step 6: Upload CSV file for bulk shortening
  if (__ITER % 20 === 0) {
    const csv = "OriginalUrl\nhttps://bulk1.com\nhttps://bulk2.com\n";
    const bulkRes = http.post(`${BASE_URL}/url/bulk`, {
      file: http.file(csv, "bulk.csv", "text/csv"),
    });
    check(bulkRes, {
      "Bulk upload worked": (r) => [200, 400].includes(r.status),
    });
  }

  // Step 7: Delete all URLs of token (simulate once every few iterations)
  if (__ITER % 50 === 0) {
    const tokenDel = http.del(`${BASE_URL}/url/del`);
    check(tokenDel, {
      "Token delete status": (r) => r.status === 200 || r.status === 500,
    });
  }

  sleep(1);
}
