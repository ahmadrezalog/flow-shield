(() => {
  'use strict';

  const DIAGNOSTIC_ATTRIBUTE = 'data-flow-local-diagnostic';
  const LOG_PREFIX = '[CFC Flow]';
  const MSG_SPEC = 'cfc-flow-spec';
  const MSG_SPEC_REQUEST = 'cfc-flow-spec-request';

  if (window.__flowLocalDiagnostic) return;
  const diag = window.__flowLocalDiagnostic = { state: 'awaiting-spec', applied: 0 };

  function setState(state, before) {
    Object.assign(diag, { state, before });
    console.info(LOG_PREFIX, JSON.stringify(diag));
    const write = () => {
      document.documentElement.setAttribute(DIAGNOSTIC_ATTRIBUTE, JSON.stringify(diag));
    };
    if (document.documentElement) write();
    else document.addEventListener('DOMContentLoaded', write, { once: true });
  }

  function isValidSpec(s) {
    return !!s && typeof s === 'object' &&
      typeof s.path === 'string' && s.path.startsWith('/') &&
      typeof s.rpcids === 'string' && s.rpcids.length > 0 &&
      typeof s.tag === 'string' && s.tag.length > 0 &&
      Number.isInteger(s.flagIndex) && s.flagIndex >= 0 &&
      Number.isInteger(s.minLength) && s.minLength > s.flagIndex;
  }

  // ---------- پچ بدنه پاسخ batchexecute ----------
  function patchBody(text, spec) {
    const lines = text.split('\n');
    let before;
    let count = 0;

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('[[')) continue;
      let frame;
      try { frame = JSON.parse(lines[i]); } catch { continue; }

      let changed = false;
      for (const entry of frame) {
        if (!Array.isArray(entry) || entry[0] !== spec.tag || entry[1] !== spec.rpcids) continue;
        const payload = JSON.parse(entry[2]);
        if (!Array.isArray(payload) || payload.length < spec.minLength ||
            (payload[spec.flagIndex] !== null && typeof payload[spec.flagIndex] !== 'boolean')) {
          throw new Error('Unexpected config schema');
        }
        before = payload[spec.flagIndex];
        payload[spec.flagIndex] = true;
        entry[2] = JSON.stringify(payload);
        count++;
        changed = true;
      }

      if (changed) {
        const oldLine = lines[i].replace(/\r$/, '');
        const declared = Number(lines[i - 1]);
        const byteLen = s => new TextEncoder().encode(s).length;
        const charLen = s => s.length;
        const measure = [byteLen, charLen].find(fn => [0, 1, 2].includes(declared - fn(oldLine)));
        if (!measure) throw new Error('Unexpected frame length');
        const newLine = JSON.stringify(frame);
        lines[i - 1] = String(declared + measure(newLine) - measure(oldLine));
        lines[i] = newLine;
      }
    }

    if (count !== 1) throw new Error('Expected one config response');
    return { body: lines.join('\n'), before };
  }

  // ---------- دریافت اسپک از link.js ----------
  let spec = null;
  let specSettled = false;
  const specWaiters = [];

  function settleSpec(value) {
    if (value) spec = value;
    if (specSettled) return;
    specSettled = true;
    specWaiters.splice(0).forEach(fn => fn(spec));
  }

  function waitForSpec() {
    return specSettled ? Promise.resolve(spec) : new Promise(r => specWaiters.push(r));
  }

  function isBatchUrl(rawUrl) {
    try {
      const u = new URL(rawUrl, location.href);
      return u.origin === location.origin && u.pathname.endsWith('/data/batchexecute');
    } catch {
      return false;
    }
  }

  function hasTargetRpc(rawUrl, s) {
    try {
      const ids = (new URL(rawUrl, location.href).searchParams.get('rpcids') || '').split(',');
      return ids.includes(s.rpcids);
    } catch {
      return false;
    }
  }

  // ---------- هوک fetch (گوگل از ۱۶ اکتبر به fetch مهاجرت کرده) ----------
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function (input, init) {
      const rawUrl = input instanceof Request ? input.url : String(input);
      const responsePromise = Reflect.apply(originalFetch, this, arguments);
      if (!isBatchUrl(rawUrl)) return responsePromise;

      const response = await responsePromise;
      const s = await waitForSpec();
      if (!s || !hasTargetRpc(rawUrl, s) || !response.ok) return response;

      let text;
      try {
        text = await response.clone().text();
      } catch {
        return response;
      }

      try {
        const result = patchBody(text, s);
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        const patched = new Response(result.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
        Object.defineProperty(patched, 'url', { value: response.url });
        Object.defineProperty(patched, 'redirected', { value: response.redirected });
        diag.applied++;
        setState('applied', result.before);
        return patched;
      } catch {
        setState('schema mismatch — unchanged');
        return response;
      }
    };
  }

  // ---------- هوک XHR (روش قدیمی، برای سازگاری نگه داشته شده) ----------
  const xhrIsTarget = new WeakMap();
  const xhrPatched = new WeakMap();
  const XHRProto = XMLHttpRequest.prototype;
  const originalOpen = XHRProto.open;

  XHRProto.open = function (method, url, ...rest) {
    let target = false;
    if (isBatchUrl(url)) target = spec ? hasTargetRpc(url, spec) : true;
    xhrIsTarget.set(this, target);
    xhrPatched.delete(this);
    return Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };

  for (const prop of ['responseText', 'response']) {
    const desc = Object.getOwnPropertyDescriptor(XHRProto, prop);
    if (!desc?.get || !desc.configurable) continue;
    Object.defineProperty(XHRProto, prop, {
      ...desc,
      get() {
        const value = Reflect.apply(desc.get, this, []);
        if (!xhrIsTarget.get(this) || typeof value !== 'string') return value;
        if (!spec) {
          diag.heldForSpec = true;
          return (this.readyState === 4 && specSettled) ? value : '';
        }
        if (this.readyState === 3) {
          diag.heldPartial = true;
          return '';
        }
        if (this.readyState !== 4) return value;
        if (!xhrPatched.has(this)) {
          try {
            const result = patchBody(value, spec);
            xhrPatched.set(this, result.body);
            diag.applied++;
            setState('applied', result.before);
          } catch {
            xhrPatched.set(this, value);
            setState('schema mismatch — unchanged');
          }
        }
        return xhrPatched.get(this);
      }
    });
  }

  // ---------- ارتباط با link.js ----------
  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== MSG_SPEC || spec) return;
    if (!isValidSpec(data.spec)) {
      setState(data.spec === null ? 'spec unavailable — inert' : 'spec invalid — inert');
      settleSpec(null);
      return;
    }
    settleSpec(data.spec);
    setState('armed');
  });

  let attempts = 0;
  const requestSpec = () => {
    if (spec || specSettled) return;
    if (attempts >= 40) {
      settleSpec(null);
      return;
    }
    attempts++;
    window.postMessage({ type: MSG_SPEC_REQUEST }, location.origin);
    setTimeout(requestSpec, 500);
  };
  requestSpec();
  setState('awaiting-spec');
})();