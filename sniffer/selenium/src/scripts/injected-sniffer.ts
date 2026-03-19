export const injectedSniffer = `
(function() {
  if (window.__simpleAudienceSniffer) {
    window.__simpleAudienceSniffer.reset();
    return;
  }

  const log = [];
  console.log('%c[selenium-sniffer] instrumentation installed (v2 — headers + raw)', 'background:#111;color:#bada55');

  const parseBody = (body) => {
    if (typeof body === 'string') {
      try { return JSON.parse(body); } catch (_) { return body; }
    }
    return body;
  };

  const extractHeaders = (init) => {
    const out = {};
    if (!init) return out;
    if (init instanceof Headers) {
      init.forEach((v, k) => { out[k] = v; });
    } else if (Array.isArray(init)) {
      init.forEach(([k, v]) => { out[k] = v; });
    } else if (typeof init === 'object') {
      Object.entries(init).forEach(([k, v]) => { out[k] = v; });
    }
    return out;
  };

  const record = (entry) => {
    log.push(entry);
    console.debug('[selenium-sniffer]', entry);
  };

  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const [resource, config] = args;

    // Extract request headers
    let reqHeaders = {};
    if (resource instanceof Request) {
      resource.headers.forEach((v, k) => { reqHeaders[k] = v; });
    }
    if (config?.headers) {
      Object.assign(reqHeaders, extractHeaders(config.headers));
    }

    const response = await originalFetch(...args);
    const clone = response.clone();

    // Capture response headers
    const resHeaders = {};
    response.headers.forEach((v, k) => { resHeaders[k] = v; });

    // Try JSON first, fall back to raw text (critical for Next.js RSC responses)
    let responseBody = null;
    let responseRaw = null;
    try {
      responseBody = await clone.json();
    } catch (_) {
      try {
        const textClone = response.clone();
        responseRaw = await textClone.text();
        responseBody = 'Not JSON';
      } catch (_2) {
        responseBody = 'Unreadable';
      }
    }

    record({
      type: 'FETCH',
      url: resource instanceof Request ? resource.url : resource,
      method: config?.method || (resource instanceof Request ? resource.method : 'GET'),
      requestHeaders: reqHeaders,
      payload: config?.body ? parseBody(config.body) : null,
      response: responseBody,
      responseRaw: responseRaw,
      responseHeaders: resHeaders,
      status: response.status,
      timestamp: new Date().toISOString()
    });

    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url) {
    this.__sniffer__url = url;
    this.__sniffer__method = method;
    this.__sniffer__reqHeaders = {};
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (this.__sniffer__reqHeaders) {
      this.__sniffer__reqHeaders[name] = value;
    }
    return originalSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    this.addEventListener('load', function() {
      let responseBody = 'Not JSON';
      let responseRaw = null;
      try {
        responseBody = JSON.parse(this.responseText);
      } catch (_) {
        responseRaw = this.responseText;
      }

      // Parse response headers
      const resHeaders = {};
      const headerStr = this.getAllResponseHeaders();
      if (headerStr) {
        headerStr.trim().split(/[\\r\\n]+/).forEach((line) => {
          const parts = line.split(': ');
          resHeaders[parts.shift()] = parts.join(': ');
        });
      }

      record({
        type: 'XHR',
        url: this.__sniffer__url,
        method: this.__sniffer__method,
        requestHeaders: this.__sniffer__reqHeaders || {},
        payload: parseBody(body),
        response: responseBody,
        responseRaw: responseRaw,
        responseHeaders: resHeaders,
        status: this.status,
        timestamp: new Date().toISOString()
      });
    });
    return originalSend.apply(this, arguments);
  };

  window.__simpleAudienceSniffer = {
    log,
    reset() {
      log.length = 0;
    },
    getLog() {
      return log;
    }
  };
})();
`;
