export const injectedSniffer = `
(function() {
  if (window.__simpleAudienceSniffer) {
    window.__simpleAudienceSniffer.reset();
    return;
  }

  const log = [];
  console.log('%c[selenium-sniffer] instrumentation installed', 'background:#111;color:#bada55');

  const parseBody = (body) => {
    if (typeof body === 'string') {
      try { return JSON.parse(body); } catch (_) { return body; }
    }
    return body;
  };

  const record = (entry) => {
    log.push(entry);
    console.debug('[selenium-sniffer]', entry);
  };

  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const [resource, config] = args;
    const response = await originalFetch(...args);
    const clone = response.clone();
    let responseBody = 'Not JSON';
    try {
      responseBody = await clone.json();
    } catch (_) {}

    record({
      type: 'FETCH',
      url: resource instanceof Request ? resource.url : resource,
      method: config?.method || 'GET',
      payload: config?.body ? parseBody(config.body) : null,
      response: responseBody,
      status: response.status,
      timestamp: new Date().toISOString()
    });

    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this.__sniffer__url = url;
    this.__sniffer__method = method;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    this.addEventListener('load', function() {
      let responseBody = 'Not JSON';
      try {
        responseBody = JSON.parse(this.responseText);
      } catch (_) {}

      record({
        type: 'XHR',
        url: this.__sniffer__url,
        method: this.__sniffer__method,
        payload: parseBody(body),
        response: responseBody,
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
